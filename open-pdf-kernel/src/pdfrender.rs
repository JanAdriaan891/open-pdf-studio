//! Page rendering with Hayro (pure Rust), following the conventions of the
//! app's PDFium route so both engines are interchangeable:
//! opaque white RGBA, bitmap size `ceil(w_pt * scale)` × `ceil(h_pt * scale)`,
//! regions in display points (after /Rotate) with a top-left origin, and an
//! extra whole-page rotation of 0/90/180/270 degrees clockwise.
//!
//! Annotations are not drawn: the app draws them itself. Form widgets are
//! annotations too, so they are not drawn either (PDFium draws form data).

use std::f64::consts::FRAC_PI_2;
use std::fmt;
use std::sync::Arc;

use hayro::hayro_interpret::util::TransformExt;
use hayro::hayro_interpret::InterpreterSettings;
use hayro::hayro_syntax::Pdf;
use hayro::{render_into, RenderCache, RenderSettings};
use vello_cpu::color::palette::css::WHITE;
use vello_cpu::kurbo::Affine;
use vello_cpu::{Pixmap, RasterizerSettings, RenderContext, Resources, TargetInit};

use crate::raster::{unpremultiply, RgbaImage, MAX_PIXELS, MAX_SIDE};

#[derive(Debug, Clone, PartialEq)]
pub enum RenderError {
    Open(String),
    PageOutOfRange(u32),
    BadRotation(i32),
    BadScale(f32),
    EmptyRegion,
    TooLarge { width: u32, height: u32 },
}

impl fmt::Display for RenderError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RenderError::Open(e) => write!(f, "Hayro could not open the PDF: {e}"),
            RenderError::PageOutOfRange(p) => write!(f, "page index {p} is out of range"),
            RenderError::BadRotation(r) => write!(f, "rotation {r} is not 0, 90, 180 or 270"),
            RenderError::BadScale(s) => write!(f, "scale {s} is not a positive number"),
            RenderError::EmptyRegion => write!(f, "render region is empty"),
            RenderError::TooLarge { width, height } => {
                write!(f, "bitmap {width}x{height} exceeds the size limit")
            }
        }
    }
}

impl std::error::Error for RenderError {}

pub struct HayroDocument {
    pdf: Pdf,
    settings: InterpreterSettings,
}

impl HayroDocument {
    pub fn open(bytes: Arc<Vec<u8>>) -> Result<HayroDocument, RenderError> {
        let pdf = Pdf::new(bytes).map_err(|e| RenderError::Open(format!("{e:?}")))?;
        let settings = InterpreterSettings {
            render_annotations: false,
            ..InterpreterSettings::default()
        };
        Ok(HayroDocument { pdf, settings })
    }

    pub fn page_count(&self) -> u32 {
        self.pdf.pages().len() as u32
    }

    /// Display size in points, after /Rotate and the crop box.
    pub fn page_size(&self, page_index: u32) -> Result<(f32, f32), RenderError> {
        let pages = self.pdf.pages();
        let page = pages
            .get(page_index as usize)
            .ok_or(RenderError::PageOutOfRange(page_index))?;
        Ok(page.render_dimensions())
    }

    pub fn render_page(
        &self,
        page_index: u32,
        scale: f32,
        rotation: i32,
    ) -> Result<RgbaImage, RenderError> {
        check_scale(scale)?;
        let quarter_turns = match rotation.rem_euclid(360) {
            r if r % 90 == 0 && rotation.abs() < 360 => r / 90,
            _ => return Err(RenderError::BadRotation(rotation)),
        };
        let (w, h) = self.page_size(page_index)?;
        let (ws, hs) = (
            f64::from(w) * f64::from(scale),
            f64::from(h) * f64::from(scale),
        );
        let turn = match quarter_turns {
            0 => Affine::IDENTITY,
            1 => Affine::translate((hs, 0.0)) * Affine::rotate(FRAC_PI_2),
            2 => Affine::translate((ws, hs)) * Affine::rotate(2.0 * FRAC_PI_2),
            _ => Affine::translate((0.0, ws)) * Affine::rotate(3.0 * FRAC_PI_2),
        };
        let (bw, bh) = if quarter_turns % 2 == 1 {
            (hs, ws)
        } else {
            (ws, hs)
        };
        self.render_with(
            page_index,
            bitmap_side(bw)?,
            bitmap_side(bh)?,
            turn * Affine::scale(f64::from(scale)),
        )
    }

    /// Render the rectangle (`x_pt`, `y_pt`, `w_pt`, `h_pt`) in display points.
    pub fn render_region(
        &self,
        page_index: u32,
        scale: f32,
        x_pt: f32,
        y_pt: f32,
        w_pt: f32,
        h_pt: f32,
    ) -> Result<RgbaImage, RenderError> {
        check_scale(scale)?;
        let valid = |v: f32| v.is_finite() && v > 0.0;
        if !valid(w_pt) || !valid(h_pt) || !x_pt.is_finite() || !y_pt.is_finite() {
            return Err(RenderError::EmptyRegion);
        }
        self.page_size(page_index)?;
        let s = f64::from(scale);
        self.render_with(
            page_index,
            bitmap_side(f64::from(w_pt) * s)?,
            bitmap_side(f64::from(h_pt) * s)?,
            Affine::translate((-f64::from(x_pt) * s, -f64::from(y_pt) * s)) * Affine::scale(s),
        )
    }

    /// Render with `view` mapping display points (top-left origin) to pixels.
    fn render_with(
        &self,
        page_index: u32,
        width: u32,
        height: u32,
        view: Affine,
    ) -> Result<RgbaImage, RenderError> {
        if width > MAX_SIDE
            || height > MAX_SIDE
            || u64::from(width) * u64::from(height) > MAX_PIXELS
        {
            return Err(RenderError::TooLarge { width, height });
        }
        let pages = self.pdf.pages();
        let page = pages
            .get(page_index as usize)
            .ok_or(RenderError::PageOutOfRange(page_index))?;
        // MAX_SIDE fits in u16.
        let (w16, h16) = (width as u16, height as u16);
        let mut ctx = RenderContext::new(w16, h16);
        let cache = RenderCache::new();
        let transform = view * page.initial_transform(true).to_kurbo();
        render_into(
            page,
            &cache,
            &self.settings,
            &RenderSettings::default(),
            &mut ctx,
            transform,
        );
        ctx.flush();
        let mut pixmap = Pixmap::new(w16, h16);
        ctx.render_with(
            &mut pixmap,
            &mut Resources::new(),
            RasterizerSettings {
                target_init: TargetInit::Clear(WHITE),
                ..RasterizerSettings::default()
            },
        );
        Ok(RgbaImage {
            width,
            height,
            data: unpremultiply(pixmap.data_as_u8_slice()),
        })
    }
}

fn check_scale(scale: f32) -> Result<(), RenderError> {
    if scale.is_finite() && scale > 0.0 {
        Ok(())
    } else {
        Err(RenderError::BadScale(scale))
    }
}

/// Bitmap side in pixels: `ceil`, as the PDFium route does, and at least 1.
fn bitmap_side(v: f64) -> Result<u32, RenderError> {
    let side = v.ceil().max(1.0);
    if side > f64::from(MAX_SIDE) {
        return Err(RenderError::TooLarge {
            width: side as u32,
            height: side as u32,
        });
    }
    Ok(side as u32)
}
