//! Annotation model: a lossless mirror of the JavaScript annotation object
//! (`open-pdf-studio/js/types/annotation.ts`).
//!
//! The fields the kernel draws and saves are typed; everything else lands in
//! `extra` and is written back unchanged. A typed field that holds `null` in
//! JavaScript is read as absent, so fields that use `null` as a value
//! (such as `groupId`) are deliberately left untyped.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

macro_rules! annotation {
    ($( $(#[$m:meta])* $field:ident : $ty:ty ),* $(,)?) => {
        #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
        #[serde(rename_all = "camelCase")]
        pub struct Annotation {
            pub id: String,
            #[serde(rename = "type")]
            pub r#type: String,
            pub page: u32,
            $(
                $(#[$m])*
                #[serde(default, skip_serializing_if = "Option::is_none")]
                pub $field: Option<$ty>,
            )*
            #[serde(flatten)]
            pub extra: Map<String, Value>,
        }
    };
}

annotation! {
    opacity: f64,
    rotation: f64,
    line_width: f64,
    border_width: f64,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    start_x: f64,
    start_y: f64,
    end_x: f64,
    end_y: f64,
    center_x: f64,
    center_y: f64,
    radius: f64,
    start_angle: f64,
    end_angle: f64,
    head_size: f64,
    arrow_x: f64,
    arrow_y: f64,
    knee_x: f64,
    knee_y: f64,
    font_size: f64,
    color: String,
    fill_color: String,
    stroke_color: String,
    border_style: String,
    start_head: String,
    end_head: String,
    text: String,
    font_family: String,
    font_weight: String,
    font_style: String,
    text_align: String,
    fill_none: bool,
    printable: bool,
    locked: bool,
    path: Vec<Point>,
    points: Vec<Point>,
    control_points: Vec<Point>,
    holes: Vec<Vec<Point>>,
}

macro_rules! kinds {
    ($( $variant:ident => $name:literal ),* $(,)?) => {
        /// Annotation type as a closed set; `Unknown` covers plugin types.
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
        pub enum Kind {
            $( $variant, )*
            Unknown,
        }

        impl Kind {
            pub fn from_type(name: &str) -> Kind {
                match name {
                    $( $name => Kind::$variant, )*
                    _ => Kind::Unknown,
                }
            }
        }
    };
}

kinds! {
    Highlight => "highlight",
    TextHighlight => "textHighlight",
    TextStrikethrough => "textStrikethrough",
    TextUnderline => "textUnderline",
    TextSquiggly => "textSquiggly",
    Caret => "caret",
    Draw => "draw",
    Line => "line",
    Arrow => "arrow",
    Box => "box",
    Circle => "circle",
    Textbox => "textbox",
    Callout => "callout",
    Comment => "comment",
    Stamp => "stamp",
    Image => "image",
    Signature => "signature",
    Polygon => "polygon",
    Cloud => "cloud",
    CloudPolyline => "cloudPolyline",
    Polyline => "polyline",
    Text => "text",
    Arc => "arc",
    Spline => "spline",
    SplineArrow => "splineArrow",
    Redaction => "redaction",
    MeasureDistance => "measureDistance",
    MeasureArea => "measureArea",
    MeasurePerimeter => "measurePerimeter",
    MeasureAngle => "measureAngle",
    FilledArea => "filledArea",
    Mask => "mask",
    Viewport => "viewport",
    ScheduleTable => "scheduleTable",
    ScaleBar => "scaleBar",
    ScaleRegion => "scaleRegion",
    ParametricSymbol => "parametricSymbol",
    Stavenreeks => "stavenreeks",
    Betonbalk => "betonbalk",
    Systeemraster => "systeemraster",
}

impl Annotation {
    pub fn kind(&self) -> Kind {
        Kind::from_type(&self.r#type)
    }
}

pub fn annotations_from_json(s: &str) -> Result<Vec<Annotation>, serde_json::Error> {
    serde_json::from_str(s)
}

pub fn annotations_to_json(a: &[Annotation]) -> Result<String, serde_json::Error> {
    serde_json::to_string(a)
}
