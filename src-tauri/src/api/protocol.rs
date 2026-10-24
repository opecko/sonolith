//! JSON-RPC 2.0 messages, framing and the error table (api/SPEC.md sections 4 and 11).

use serde_json::{json, Map, Value};
use tokio::io::{AsyncBufRead, AsyncBufReadExt};

pub const API_VERSION: &str = "1.0.0";
pub const API_MAJOR: &str = "1";
/// Largest message in either direction, without the line feed.
pub const MAX_MESSAGE: usize = 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Code {
    ParseError,
    InvalidRequest,
    MethodNotFound,
    InvalidParams,
    InternalError,
    NotRegistered,
    Unauthorized,
    PermissionDenied,
    RegistrationPending,
    RegistrationDenied,
    Blocked,
    NotSignedIn,
    NotFound,
    RateLimited,
    Unavailable,
    Timeout,
    SessionRequired,
    UnsupportedVersion,
}

impl Code {
    pub fn number(self) -> i64 {
        match self {
            Code::ParseError => -32700,
            Code::InvalidRequest => -32600,
            Code::MethodNotFound => -32601,
            Code::InvalidParams => -32602,
            Code::InternalError => -32603,
            Code::NotRegistered => -32001,
            Code::Unauthorized => -32002,
            Code::PermissionDenied => -32003,
            Code::RegistrationPending => -32004,
            Code::RegistrationDenied => -32005,
            Code::Blocked => -32006,
            Code::NotSignedIn => -32007,
            Code::NotFound => -32008,
            Code::RateLimited => -32009,
            Code::Unavailable => -32010,
            Code::Timeout => -32011,
            Code::SessionRequired => -32012,
            Code::UnsupportedVersion => -32013,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Code::ParseError => "ParseError",
            Code::InvalidRequest => "InvalidRequest",
            Code::MethodNotFound => "MethodNotFound",
            Code::InvalidParams => "InvalidParams",
            Code::InternalError => "InternalError",
            Code::NotRegistered => "NotRegistered",
            Code::Unauthorized => "Unauthorized",
            Code::PermissionDenied => "PermissionDenied",
            Code::RegistrationPending => "RegistrationPending",
            Code::RegistrationDenied => "RegistrationDenied",
            Code::Blocked => "Blocked",
            Code::NotSignedIn => "NotSignedIn",
            Code::NotFound => "NotFound",
            Code::RateLimited => "RateLimited",
            Code::Unavailable => "Unavailable",
            Code::Timeout => "Timeout",
            Code::SessionRequired => "SessionRequired",
            Code::UnsupportedVersion => "UnsupportedVersion",
        }
    }

    pub fn from_name(name: &str) -> Option<Code> {
        ALL.iter().copied().find(|c| c.name() == name)
    }
}

const ALL: [Code; 18] = [
    Code::ParseError,
    Code::InvalidRequest,
    Code::MethodNotFound,
    Code::InvalidParams,
    Code::InternalError,
    Code::NotRegistered,
    Code::Unauthorized,
    Code::PermissionDenied,
    Code::RegistrationPending,
    Code::RegistrationDenied,
    Code::Blocked,
    Code::NotSignedIn,
    Code::NotFound,
    Code::RateLimited,
    Code::Unavailable,
    Code::Timeout,
    Code::SessionRequired,
    Code::UnsupportedVersion,
];

/// A JSON-RPC error: code, reason and extra `data` members.
#[derive(Clone, Debug, PartialEq)]
pub struct RpcError {
    pub code: Code,
    pub reason: Option<String>,
    pub extra: Map<String, Value>,
}

impl RpcError {
    pub fn new(code: Code) -> Self {
        RpcError { code, reason: None, extra: Map::new() }
    }
    pub fn reason(mut self, reason: &str) -> Self {
        self.reason = Some(reason.into());
        self
    }
    pub fn with(mut self, key: &str, value: impl Into<Value>) -> Self {
        self.extra.insert(key.into(), value.into());
        self
    }

    pub fn to_json(&self) -> Value {
        let mut data = Map::new();
        data.insert("name".into(), self.code.name().into());
        data.insert("reason".into(), self.reason.clone().map(Value::String).unwrap_or(Value::Null));
        for (k, v) in &self.extra {
            data.insert(k.clone(), v.clone());
        }
        json!({ "code": self.code.number(), "message": self.code.name(), "data": data })
    }

    /// An error object from the frontend bridge (`{ name, reason?, …extra }`); unknown names become InternalError.
    pub fn from_bridge(v: &Value) -> Self {
        let code = v.get("name").and_then(Value::as_str).and_then(Code::from_name).unwrap_or(Code::InternalError);
        let mut e = RpcError::new(code);
        if let Some(r) = v.get("reason").and_then(Value::as_str) {
            e.reason = Some(r.into());
        }
        if let Some(obj) = v.as_object() {
            for (k, val) in obj {
                if !matches!(k.as_str(), "name" | "reason" | "message") {
                    e.extra.insert(k.clone(), val.clone());
                }
            }
        }
        e
    }
}

pub fn response(id: &Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

pub fn error_response(id: &Value, err: &RpcError) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": err.to_json() })
}

pub fn notification(method: &str, params: Value) -> Value {
    json!({ "jsonrpc": "2.0", "method": method, "params": params })
}

/// A parsed request. `id` is None for client notifications (never answered).
#[derive(Debug)]
pub struct Request {
    pub id: Option<Value>,
    pub method: String,
    pub params: Map<String, Value>,
}

/// Parses one line. On failure returns the error and the id to answer with (null when unknown).
pub fn parse(line: &[u8]) -> Result<Request, (Value, RpcError)> {
    let text = std::str::from_utf8(line).map_err(|_| (Value::Null, RpcError::new(Code::ParseError)))?;
    let v: Value = serde_json::from_str(text).map_err(|_| (Value::Null, RpcError::new(Code::ParseError)))?;
    if v.is_array() {
        return Err((Value::Null, RpcError::new(Code::InvalidRequest).reason("batchNotSupported")));
    }
    let Value::Object(mut obj) = v else {
        return Err((Value::Null, RpcError::new(Code::InvalidRequest)));
    };
    let id = obj.remove("id");
    let reply_id = id.clone().unwrap_or(Value::Null);
    if let Some(i) = &id {
        if !(i.is_string() || i.is_i64() || i.is_u64()) {
            return Err((Value::Null, RpcError::new(Code::InvalidRequest)));
        }
    }
    if obj.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
        return Err((reply_id, RpcError::new(Code::InvalidRequest)));
    }
    let Some(Value::String(method)) = obj.remove("method") else {
        return Err((reply_id, RpcError::new(Code::InvalidRequest)));
    };
    let params = match obj.remove("params") {
        None | Some(Value::Null) => Map::new(),
        Some(Value::Object(m)) => m,
        Some(_) => return Err((reply_id, RpcError::new(Code::InvalidParams).reason("byPositionNotSupported"))),
    };
    Ok(Request { id, method, params })
}

pub enum Line {
    Message(Vec<u8>),
    TooLarge,
    Eof,
}

/// Reads one line of at most `MAX_MESSAGE` bytes (without the line feed and an optional carriage return).
/// Never buffers more than the limit: an oversized line is reported as soon as it passes the limit.
pub async fn read_line<R: AsyncBufRead + Unpin>(r: &mut R, buf: &mut Vec<u8>) -> std::io::Result<Line> {
    buf.clear();
    loop {
        let available = r.fill_buf().await?;
        if available.is_empty() {
            return Ok(if buf.is_empty() { Line::Eof } else { Line::Message(std::mem::take(buf)) });
        }
        let (chunk, found) = match available.iter().position(|&b| b == b'\n') {
            Some(i) => (&available[..i], Some(i)),
            None => (available, None),
        };
        if buf.len() + chunk.len() > MAX_MESSAGE {
            return Ok(Line::TooLarge);
        }
        buf.extend_from_slice(chunk);
        let used = found.map(|i| i + 1).unwrap_or(chunk.len());
        r.consume(used);
        if found.is_some() {
            if buf.last() == Some(&b'\r') {
                buf.pop();
            }
            return Ok(Line::Message(std::mem::take(buf)));
        }
    }
}

/// The client's `apiVersion` ("MAJOR.MINOR") is supported when its major is ours.
pub fn version_supported(v: &str) -> bool {
    v.split('.').next() == Some(API_MAJOR)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_requests_and_rejects_bad_ones() {
        let r = parse(br#"{"jsonrpc":"2.0","id":1,"method":"player.play"}"#).unwrap();
        assert_eq!(r.method, "player.play");
        assert!(r.params.is_empty());
        assert_eq!(parse(b"{not json").unwrap_err().1.code, Code::ParseError);
        assert_eq!(parse(&[0xff, 0xfe]).unwrap_err().1.code, Code::ParseError);
        let (_, e) = parse(br#"[{"jsonrpc":"2.0","id":1,"method":"x"}]"#).unwrap_err();
        assert_eq!(e.reason.as_deref(), Some("batchNotSupported"));
        let (id, e) = parse(br#"{"jsonrpc":"2.0","id":"a","method":"x","params":[1]}"#).unwrap_err();
        assert_eq!((id, e.code), (json!("a"), Code::InvalidParams));
        assert_eq!(parse(br#"{"jsonrpc":"1.0","id":1,"method":"x"}"#).unwrap_err().1.code, Code::InvalidRequest);
        assert_eq!(parse(br#"{"jsonrpc":"2.0","id":1.5,"method":"x"}"#).unwrap_err().1.code, Code::InvalidRequest);
        assert!(parse(br#"{"jsonrpc":"2.0","method":"x"}"#).unwrap().id.is_none());
    }

    #[test]
    fn error_json_has_name_and_reason() {
        let e = RpcError::new(Code::PermissionDenied).with("scope", "library:read").to_json();
        assert_eq!(e["code"], -32003);
        assert_eq!(e["data"], json!({"name": "PermissionDenied", "reason": null, "scope": "library:read"}));
        let b = RpcError::from_bridge(&json!({"name": "NotFound", "reason": "x", "message": "m"}));
        assert_eq!((b.code, b.reason.as_deref(), b.extra.len()), (Code::NotFound, Some("x"), 0));
        assert_eq!(RpcError::from_bridge(&json!({"name": "Bogus"})).code, Code::InternalError);
    }

    #[tokio::test]
    async fn framing_limits_and_crlf() {
        let mut big = vec![b'a'; MAX_MESSAGE + 10];
        big.push(b'\n');
        let data = [b"one\r\n".to_vec(), b"two\n".to_vec(), big, b"tail".to_vec()].concat();
        let mut r = tokio::io::BufReader::with_capacity(4096, &data[..]);
        let mut buf = Vec::new();
        assert!(matches!(read_line(&mut r, &mut buf).await.unwrap(), Line::Message(m) if m == b"one"));
        assert!(matches!(read_line(&mut r, &mut buf).await.unwrap(), Line::Message(m) if m == b"two"));
        assert!(matches!(read_line(&mut r, &mut buf).await.unwrap(), Line::TooLarge));
        let mut exact = vec![b'b'; MAX_MESSAGE];
        exact.push(b'\n');
        let mut r = tokio::io::BufReader::new(&exact[..]);
        assert!(matches!(read_line(&mut r, &mut buf).await.unwrap(), Line::Message(m) if m.len() == MAX_MESSAGE));
        assert!(matches!(read_line(&mut r, &mut buf).await.unwrap(), Line::Eof));
    }

    #[test]
    fn versions() {
        assert!(version_supported("1.0") && version_supported("1.7"));
        assert!(!version_supported("2.0") && !version_supported("x"));
    }
}
