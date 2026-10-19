use std::collections::HashSet;

use open_pdf_kernel::model::{annotations_from_json, annotations_to_json, Kind};
use serde_json::Value;

const FIXTURE: &str = include_str!("fixtures/annotations-all-types.json");

/// Numbers compare by f64 value and a key holding `null` equals a missing key:
/// JavaScript treats both pairs the same way.
fn json_equivalent(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        (Value::Array(x), Value::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(p, q)| json_equivalent(p, q))
        }
        (Value::Object(x), Value::Object(y)) => {
            let keys: HashSet<&String> = x.keys().chain(y.keys()).collect();
            keys.into_iter().all(|k| {
                let p = x.get(k).unwrap_or(&Value::Null);
                let q = y.get(k).unwrap_or(&Value::Null);
                json_equivalent(p, q)
            })
        }
        _ => a == b,
    }
}

fn roundtrip() -> (Value, Value) {
    let parsed = annotations_from_json(FIXTURE).expect("fixture parses");
    let written = annotations_to_json(&parsed).expect("serializes");
    let before: Value = serde_json::from_str(FIXTURE).unwrap();
    let after: Value = serde_json::from_str(&written).unwrap();
    (before, after)
}

fn find<'a>(list: &'a Value, id: &str) -> &'a Value {
    list.as_array()
        .unwrap()
        .iter()
        .find(|a| a["id"] == id)
        .unwrap_or_else(|| panic!("annotation {id} missing"))
}

#[test]
fn model_roundtrip_is_lossless() {
    let (before, after) = roundtrip();
    assert!(
        json_equivalent(&before, &after),
        "round trip changed the model:\n{after}"
    );
}

#[test]
fn kind_maps_all_known_types() {
    let parsed = annotations_from_json(FIXTURE).unwrap();
    let known: Vec<_> = parsed
        .iter()
        .filter(|a| a.r#type != "pluginShape")
        .collect();
    assert!(known.iter().all(|a| a.kind() != Kind::Unknown));
    let distinct: HashSet<Kind> = known.iter().map(|a| a.kind()).collect();
    assert_eq!(distinct.len(), 40);
}

#[test]
fn unknown_type_survives() {
    let parsed = annotations_from_json(FIXTURE).unwrap();
    let plugin = parsed.iter().find(|a| a.id == "a42").unwrap();
    assert_eq!(plugin.kind(), Kind::Unknown);
    let (_, after) = roundtrip();
    assert_eq!(find(&after, "a42")["type"], "pluginShape");
}

#[test]
fn null_valued_untyped_field_survives() {
    let (_, after) = roundtrip();
    let caret_strike = find(&after, "a03");
    assert_eq!(caret_strike.get("groupId"), Some(&Value::Null));
}

#[test]
fn extra_preserves_nested_unknown_field() {
    let (_, after) = roundtrip();
    let schedule = find(&after, "a34");
    let expected: Value = serde_json::from_str(r#"{"a":[1,2.5,"x"]}"#).unwrap();
    assert_eq!(schedule["pluginData"], expected);
}
