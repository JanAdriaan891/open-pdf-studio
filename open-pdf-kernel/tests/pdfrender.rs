use std::path::PathBuf;
use std::sync::Arc;

use open_pdf_kernel::pdfrender::{HayroDocument, RenderError};
use open_pdf_kernel::raster::RgbaImage;

const WHITE: [u8; 4] = [255, 255, 255, 255];
const RED: [u8; 4] = [255, 0, 0, 255];

fn test_pdf(name: &str) -> Arc<Vec<u8>> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../test pdf-bestanden/Testbestanden")
        .join(name);
    Arc::new(std::fs::read(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display())))
}

struct PageSpec<'a> {
    media: [f32; 4],
    crop: Option<[f32; 4]>,
    rotate: i32,
    content: &'a str,
    /// Black-filled Square annotation with an appearance stream over this rect.
    annot: Option<[f32; 4]>,
}

/// A one-page PDF with a correct cross-reference table.
fn one_page_pdf(spec: &PageSpec) -> Arc<Vec<u8>> {
    let fmt = |b: [f32; 4]| format!("[{} {} {} {}]", b[0], b[1], b[2], b[3]);
    let mut page = format!(
        "<< /Type /Page /Parent 2 0 R /MediaBox {} /Rotate {} /Contents 4 0 R",
        fmt(spec.media),
        spec.rotate
    );
    if let Some(c) = spec.crop {
        page += &format!(" /CropBox {}", fmt(c));
    }
    if spec.annot.is_some() {
        page += " /Annots [5 0 R]";
    }
    page += " >>";
    let mut objs = vec![
        "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
        page,
        format!(
            "<< /Length {} >>\nstream\n{}\nendstream",
            spec.content.len(),
            spec.content
        ),
    ];
    if let Some(r) = spec.annot {
        let ap = format!("0 g 0 0 {} {} re f", r[2] - r[0], r[3] - r[1]);
        objs.push(format!(
            "<< /Type /Annot /Subtype /Square /Rect {} /AP << /N 6 0 R >> >>",
            fmt(r)
        ));
        objs.push(format!(
            "<< /Type /XObject /Subtype /Form /BBox [0 0 {} {}] /Length {} >>\nstream\n{}\nendstream",
            r[2] - r[0],
            r[3] - r[1],
            ap.len(),
            ap
        ));
    }
    let mut out = b"%PDF-1.7\n".to_vec();
    let mut offsets = Vec::new();
    for (i, body) in objs.iter().enumerate() {
        offsets.push(out.len());
        out.extend_from_slice(format!("{} 0 obj\n{}\nendobj\n", i + 1, body).as_bytes());
    }
    let xref = out.len();
    out.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", objs.len() + 1).as_bytes());
    for o in offsets {
        out.extend_from_slice(format!("{o:010} 00000 n \n").as_bytes());
    }
    out.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
            objs.len() + 1
        )
        .as_bytes(),
    );
    Arc::new(out)
}

/// 200×100 pt page, left 50 pt red.
fn red_left_strip(rotate: i32, crop: Option<[f32; 4]>) -> Arc<Vec<u8>> {
    one_page_pdf(&PageSpec {
        media: [0.0, 0.0, 200.0, 100.0],
        crop,
        rotate,
        content: "1 0 0 rg 0 0 50 100 re f",
        annot: None,
    })
}

fn px(img: &RgbaImage, x: u32, y: u32) -> [u8; 4] {
    let i = ((y * img.width + x) * 4) as usize;
    img.data[i..i + 4].try_into().unwrap()
}

#[test]
fn page_count_matches() {
    let doc = HayroDocument::open(test_pdf("Tekst.pdf")).unwrap();
    assert_eq!(doc.page_count(), 5);
}

#[test]
fn page_size_ceil_matches_bitmap() {
    let pdf = one_page_pdf(&PageSpec {
        media: [0.0, 0.0, 200.5, 100.2],
        crop: None,
        rotate: 0,
        content: "",
        annot: None,
    });
    let doc = HayroDocument::open(pdf).unwrap();
    let (w, h) = doc.page_size(0).unwrap();
    assert!(
        (w - 200.5).abs() < 1e-3 && (h - 100.2).abs() < 1e-3,
        "{w}x{h}"
    );
    let img = doc.render_page(0, 1.5, 0).unwrap();
    assert_eq!((img.width, img.height), (301, 151));
    assert_eq!(px(&img, 150, 75), WHITE, "background is opaque white");
}

#[test]
fn rotation_90_swaps_axes() {
    let doc = HayroDocument::open(red_left_strip(0, None)).unwrap();
    let img = doc.render_page(0, 1.0, 90).unwrap();
    assert_eq!((img.width, img.height), (100, 200));
    // Clockwise: the red left edge ends up at the top.
    assert_eq!(px(&img, 50, 10), RED);
    assert_eq!(px(&img, 50, 190), WHITE);
}

#[test]
fn rotated_page_size_matches_display_size() {
    let doc = HayroDocument::open(red_left_strip(90, None)).unwrap();
    assert_eq!(doc.page_size(0).unwrap(), (100.0, 200.0));
    let img = doc.render_page(0, 1.0, 0).unwrap();
    assert_eq!((img.width, img.height), (100, 200));
    assert_eq!(px(&img, 50, 10), RED);
    assert_eq!(px(&img, 50, 190), WHITE);
}

#[test]
fn cropbox_offset_is_applied() {
    let doc = HayroDocument::open(red_left_strip(0, Some([50.0, 0.0, 200.0, 100.0]))).unwrap();
    assert_eq!(doc.page_size(0).unwrap(), (150.0, 100.0));
    let img = doc.render_page(0, 1.0, 0).unwrap();
    assert_eq!(
        px(&img, 5, 50),
        WHITE,
        "the red strip lies outside the crop box"
    );
}

#[test]
fn annotations_are_not_drawn() {
    let pdf = one_page_pdf(&PageSpec {
        media: [0.0, 0.0, 200.0, 100.0],
        crop: None,
        rotate: 0,
        content: "",
        annot: Some([100.0, 20.0, 180.0, 80.0]),
    });
    let img = HayroDocument::open(pdf)
        .unwrap()
        .render_page(0, 1.0, 0)
        .unwrap();
    assert_eq!(px(&img, 140, 50), WHITE, "the app draws annotations itself");
}

#[test]
fn region_matches_crop_of_page() {
    let doc = HayroDocument::open(test_pdf("Technische tekening.pdf")).unwrap();
    let page = doc.render_page(0, 1.0, 0).unwrap();
    let (rx, ry, rw, rh) = (300u32, 200u32, 240u32, 160u32);
    let region = doc
        .render_region(0, 1.0, rx as f32, ry as f32, rw as f32, rh as f32)
        .unwrap();
    assert_eq!((region.width, region.height), (rw, rh));
    let mut worst = 0u8;
    for y in 1..rh - 1 {
        for x in 1..rw - 1 {
            let a = px(&region, x, y);
            let b = px(&page, rx + x, ry + y);
            for c in 0..4 {
                worst = worst.max(a[c].abs_diff(b[c]));
            }
        }
    }
    assert!(worst <= 3, "region differs from the page crop by {worst}");
}

#[test]
fn region_outside_page_is_white() {
    let doc = HayroDocument::open(red_left_strip(0, None)).unwrap();
    let img = doc.render_region(0, 2.0, -50.0, -50.0, 40.0, 40.0).unwrap();
    assert_eq!((img.width, img.height), (80, 80));
    assert!(img.data.chunks(4).all(|p| p == WHITE));
}

#[test]
fn invalid_pdf_is_error() {
    let err = HayroDocument::open(Arc::new(b"not a pdf".to_vec()));
    assert!(matches!(err, Err(RenderError::Open(_))));
}

#[test]
fn bad_arguments_are_errors() {
    let doc = HayroDocument::open(red_left_strip(0, None)).unwrap();
    assert!(matches!(
        doc.render_page(1, 1.0, 0),
        Err(RenderError::PageOutOfRange(1))
    ));
    assert!(matches!(
        doc.render_page(0, 1.0, 45),
        Err(RenderError::BadRotation(45))
    ));
    assert!(matches!(
        doc.render_region(0, 1.0, 0.0, 0.0, 0.0, 10.0),
        Err(RenderError::EmptyRegion)
    ));
    assert!(matches!(
        doc.render_page(0, 200.0, 0),
        Err(RenderError::TooLarge { .. })
    ));
}
