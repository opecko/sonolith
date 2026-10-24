//! Checks the params of methods the frontend answers against api/openrpc.json and the schemas, so the bridge only
//! ever sees well-formed calls and every client gets the same `InvalidParams` answers the spec describes.
//!
//! A small JSON Schema subset: what the schemas use for params (`$ref`, `type`, `enum`, `const`, `oneOf`, `allOf`,
//! objects, arrays, number and length bounds). `pattern` and `format` only appear on params the server checks itself.

use super::protocol::{Code, RpcError};
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::sync::LazyLock;

struct Spec {
    /// Method → (params by name with their schema and whether required, extra constraints on the whole object).
    methods: HashMap<String, (Vec<(String, Value, bool)>, Option<Value>)>,
    /// Every `$defs` entry of every schema file; names are unique across files.
    defs: HashMap<String, Value>,
}

static SPEC: LazyLock<Spec> = LazyLock::new(|| {
    let parse = |s: &str| serde_json::from_str::<Value>(s).expect("embedded API spec");
    let doc = parse(include_str!("../../../api/openrpc.json"));
    let mut defs = HashMap::new();
    for file in [
        include_str!("../../../api/schema/common.schema.json"),
        include_str!("../../../api/schema/media.schema.json"),
        include_str!("../../../api/schema/player.schema.json"),
        include_str!("../../../api/schema/lyrics.schema.json"),
        include_str!("../../../api/schema/session.schema.json"),
    ] {
        if let Some(d) = parse(file)["$defs"].as_object() {
            defs.extend(d.iter().map(|(k, v)| (k.clone(), v.clone())));
        }
    }
    let methods = doc["methods"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|m| {
            let params = m["params"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|p| (p["name"].as_str().unwrap_or("").to_string(), p["schema"].clone(), p["required"] == true))
                .collect();
            (m["name"].as_str().unwrap_or("").to_string(), (params, m.get("x-params-constraints").cloned()))
        })
        .collect();
    Spec { methods, defs }
});

fn invalid(path: &str) -> RpcError {
    RpcError::new(Code::InvalidParams).with("path", path.to_string())
}

/// Ok, or `InvalidParams` with `data.path` at the first bad param (`unknownParam` for names the method lacks).
pub fn check(method: &str, params: &Map<String, Value>) -> Result<(), RpcError> {
    let Some((list, constraints)) = SPEC.methods.get(method) else { return Ok(()) };
    if let Some(k) = params.keys().find(|k| !list.iter().any(|(n, _, _)| n == *k)) {
        return Err(RpcError::new(Code::InvalidParams).reason("unknownParam").with("path", format!("/{k}")));
    }
    for (name, schema, required) in list {
        match params.get(name) {
            None if *required => return Err(invalid(&format!("/{name}"))),
            None => {}
            Some(v) => matches(schema, v, &format!("/{name}")).map_err(|p| invalid(&p))?,
        }
    }
    if let Some(c) = constraints {
        matches(c, &Value::Object(params.clone()), "").map_err(|_| invalid(""))?;
    }
    Ok(())
}

/// Ok, or Err(the JSON pointer of the value that does not match).
fn matches(s: &Value, v: &Value, path: &str) -> Result<(), String> {
    let fail = || Err(path.to_string());
    if let Some(r) = s["$ref"].as_str() {
        let name = r.rsplit('/').next().unwrap_or("");
        return match SPEC.defs.get(name) {
            Some(d) => matches(d, v, path),
            None => fail(),
        };
    }
    if let Some(all) = s["allOf"].as_array() {
        for x in all {
            matches(x, v, path)?;
        }
    }
    if let Some(any) = s["oneOf"].as_array() {
        let ok: Vec<Result<(), String>> = any.iter().map(|x| matches(x, v, path)).collect();
        match ok.iter().filter(|r| r.is_ok()).count() {
            1 => {}
            // One alternative alone: point inside it (a bad field of an object) rather than at the object.
            0 if ok.len() == 1 => return ok.into_iter().next().unwrap(),
            _ => return fail(),
        }
    }
    if let Some(c) = s.get("const") {
        if c != v {
            return fail();
        }
    }
    if let Some(e) = s["enum"].as_array() {
        if !e.contains(v) {
            return fail();
        }
    }
    let types: Vec<&str> = match &s["type"] {
        Value::String(t) => vec![t.as_str()],
        Value::Array(a) => a.iter().filter_map(Value::as_str).collect(),
        _ => vec![],
    };
    if !types.is_empty() && !types.iter().any(|t| is_type(t, v)) {
        return fail();
    }
    match v {
        Value::Number(n) => {
            let x = n.as_f64().unwrap_or(f64::NAN);
            let below = s["minimum"].as_f64().is_some_and(|m| x < m) || s["exclusiveMinimum"].as_f64().is_some_and(|m| x <= m);
            if below || s["maximum"].as_f64().is_some_and(|m| x > m) {
                return fail();
            }
        }
        Value::String(t) => {
            let n = t.chars().count() as u64;
            if s["minLength"].as_u64().is_some_and(|m| n < m) || s["maxLength"].as_u64().is_some_and(|m| n > m) {
                return fail();
            }
        }
        Value::Array(items) => {
            let n = items.len() as u64;
            if s["minItems"].as_u64().is_some_and(|m| n < m) || s["maxItems"].as_u64().is_some_and(|m| n > m) {
                return fail();
            }
            if let Some(item) = s.get("items") {
                for (i, x) in items.iter().enumerate() {
                    matches(item, x, &format!("{path}/{i}"))?;
                }
            }
        }
        Value::Object(o) => {
            if s["minProperties"].as_u64().is_some_and(|m| (o.len() as u64) < m) {
                return fail();
            }
            for r in s["required"].as_array().into_iter().flatten().filter_map(Value::as_str) {
                if !o.contains_key(r) {
                    return Err(format!("{path}/{r}"));
                }
            }
            let props = s["properties"].as_object();
            for (k, x) in o {
                match props.and_then(|p| p.get(k)) {
                    Some(ps) => matches(ps, x, &format!("{path}/{k}"))?,
                    None if s["additionalProperties"] == false => return Err(format!("{path}/{k}")),
                    None => {}
                }
            }
        }
        _ => {}
    }
    Ok(())
}

fn is_type(t: &str, v: &Value) -> bool {
    match t {
        "null" => v.is_null(),
        "boolean" => v.is_boolean(),
        "string" => v.is_string(),
        "array" => v.is_array(),
        "object" => v.is_object(),
        "number" => v.is_number(),
        "integer" => v.as_i64().is_some() || v.as_u64().is_some() || v.as_f64().is_some_and(|f| f.fract() == 0.0),
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn check_json(method: &str, p: Value) -> Result<(), (String, Option<String>)> {
        check(method, p.as_object().unwrap()).map_err(|e| {
            let j = e.to_json();
            (j["data"]["path"].as_str().unwrap_or("").to_string(), j["data"]["reason"].as_str().map(String::from))
        })
    }

    #[test]
    fn every_method_example_is_valid() {
        let doc: Value = serde_json::from_str(include_str!("../../../api/openrpc.json")).unwrap();
        for m in doc["methods"].as_array().unwrap() {
            for ex in m["examples"].as_array().into_iter().flatten() {
                let params: Map<String, Value> =
                    ex["params"].as_array().unwrap().iter().map(|p| (p["name"].as_str().unwrap().to_string(), p["value"].clone())).collect();
                let name = m["name"].as_str().unwrap();
                assert!(check(name, &params).is_ok(), "{name}: {params:?}");
            }
        }
    }

    #[test]
    fn reports_the_bad_param() {
        assert_eq!(check_json("player.seek", json!({ "positionMs": 5 })), Ok(()));
        assert_eq!(check_json("player.seek", json!({})), Err(("".into(), None)));
        assert_eq!(check_json("player.seek", json!({ "positionMs": 5, "offsetMs": 1 })), Err(("".into(), None)));
        assert_eq!(check_json("player.seek", json!({ "positionMs": -1 })), Err(("/positionMs".into(), None)));
        assert_eq!(check_json("player.seek", json!({ "at": 1 })), Err(("/at".into(), Some("unknownParam".into()))));
        assert_eq!(check_json("player.setVolume", json!({})), Err(("".into(), None)));
        assert_eq!(check_json("player.setVolume", json!({ "volume": 101 })), Err(("/volume".into(), None)));
        assert_eq!(check_json("player.setRate", json!({ "rate": 1.5 })), Ok(()));
        assert_eq!(check_json("player.setRate", json!({ "rate": 1.4 })), Err(("/rate".into(), None)));
        assert_eq!(check_json("player.playItem", json!({ "item": { "type": "artist", "id": "x" } })), Err(("/item/type".into(), None)));
        assert_eq!(check_json("player.playItem", json!({ "item": { "type": "album", "id": "x", "extra": 1 } })), Err(("/item/extra".into(), None)));
        assert_eq!(check_json("queue.add", json!({ "items": [{ "type": "track", "id": "a" }, { "type": "track" }] })), Err(("/items/1/id".into(), None)));
        assert_eq!(check_json("queue.get", json!({ "limit": 0 })), Err(("/limit".into(), None)));
        assert_eq!(check_json("queue.get", json!({ "limit": 100 })), Ok(()));
        assert_eq!(check_json("search.query", json!({ "query": "a", "type": "songs" })), Ok(()));
        assert_eq!(check_json("search.query", json!({ "query": "", "type": "songs" })), Err(("/query".into(), None)));
        assert_eq!(check_json("search.query", json!({ "query": "a", "type": "song" })), Err(("/type".into(), None)));
        assert_eq!(check_json("rating.set", json!({ "item": { "type": "track", "id": "a" }, "rating": "like" })), Ok(()));
        assert_eq!(check_json("lyrics.get", json!({})), Ok(()));
    }
}
