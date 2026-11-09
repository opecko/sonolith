//! Just enough HTTP/1.1 for the phone remote: one request per connection, a capped head and body, and responses
//! that close the connection. Pure, so the parsing is tested without sockets.

/// Request line plus headers.
pub const MAX_HEAD: usize = 8 * 1024;

#[derive(Debug, PartialEq, Eq)]
pub struct Head {
    pub method: String,
    /// The path without the query string.
    pub path: String,
    /// Header names in lower case.
    pub headers: Vec<(String, String)>,
}

impl Head {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str())
    }

    /// `Content-Length`, 0 when missing; None when it is not a number or the body is chunked.
    pub fn content_length(&self) -> Option<usize> {
        if self.header("transfer-encoding").is_some() {
            return None;
        }
        match self.header("content-length") {
            None => Some(0),
            Some(v) => v.parse().ok(),
        }
    }

    /// The `Host` names an IP address (with or without a port), as the pairing link does. A host *name* means the
    /// request came through DNS, possibly a rebinding attack (a site whose name points at this computer): refused.
    pub fn host_is_ip(&self) -> bool {
        let Some(h) = self.header("host") else { return false };
        let addr = match h.strip_prefix('[') {
            // [v6] or [v6]:port
            Some(rest) => rest.split_once(']').filter(|(_, port)| port.is_empty() || port.strip_prefix(':').is_some_and(port_ok)).map(|(a, _)| a),
            None => match h.rsplit_once(':') {
                Some((a, port)) if port_ok(port) => Some(a),
                Some(_) => None,
                None => Some(h),
            },
        };
        addr.is_some_and(|a| a.parse::<std::net::IpAddr>().is_ok())
    }

    /// `Authorization: Bearer <appId>:<token>`.
    pub fn bearer(&self) -> Option<(&str, &str)> {
        let v = self.header("authorization")?.strip_prefix("Bearer ")?;
        v.trim().split_once(':')
    }
}

fn port_ok(p: &str) -> bool {
    !p.is_empty() && p.len() <= 5 && p.bytes().all(|b| b.is_ascii_digit())
}

/// Where the head ends (the index after the blank line), once it is all in `buf`.
pub fn head_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n").map(|i| i + 4)
}

/// Parses a complete head. None for anything malformed or not plain ASCII.
pub fn parse_head(raw: &[u8]) -> Option<Head> {
    let text = std::str::from_utf8(raw).ok()?;
    if !text.is_ascii() {
        return None;
    }
    let mut lines = text.split("\r\n");
    let mut first = lines.next()?.split(' ');
    let method = first.next()?.to_string();
    let target = first.next()?;
    let version = first.next()?;
    if first.next().is_some() || !version.starts_with("HTTP/1.") || !target.starts_with('/') {
        return None;
    }
    let path = target.split(['?', '#']).next().unwrap_or("/").to_string();
    let mut headers = Vec::new();
    for line in lines.take_while(|l| !l.is_empty()) {
        let (k, v) = line.split_once(':')?;
        headers.push((k.trim().to_ascii_lowercase(), v.trim().to_string()));
    }
    Some(Head { method, path, headers })
}

/// Headers every response carries: nothing is cached, nothing is sniffed, no other site may frame or read it.
const COMMON: &str = "Cache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\n\
X-Frame-Options: DENY\r\nCross-Origin-Resource-Policy: same-origin\r\nConnection: close\r\n";

/// The page may load only its own files and artwork over HTTPS.
pub const PAGE_CSP: &str = "default-src 'none'; script-src 'self'; style-src 'self'; img-src https: data:; \
connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

pub fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        202 => "Accepted",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        408 => "Request Timeout",
        409 => "Conflict",
        413 => "Payload Too Large",
        429 => "Too Many Requests",
        431 => "Request Header Fields Too Large",
        _ => "Service Unavailable",
    }
}

/// A complete response with a body.
pub fn response(status: u16, content_type: &str, extra: &str, body: &[u8]) -> Vec<u8> {
    let mut out = format!(
        "HTTP/1.1 {status} {}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\n{COMMON}{extra}\r\n",
        reason(status),
        body.len()
    )
    .into_bytes();
    out.extend_from_slice(body);
    out
}

pub fn json(status: u16, body: &serde_json::Value) -> Vec<u8> {
    response(status, "application/json", "", body.to_string().as_bytes())
}

/// The head of an event stream: no length, the body runs until the connection closes.
pub fn stream_head() -> Vec<u8> {
    format!("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n{COMMON}\r\n").into_bytes()
}

/// One server-sent event. `data` is a single line of JSON, so it never needs splitting.
pub fn event(name: Option<&str>, data: &str) -> Vec<u8> {
    let mut s = String::new();
    if let Some(n) = name {
        s.push_str("event: ");
        s.push_str(n);
        s.push('\n');
    }
    s.push_str("data: ");
    s.push_str(&data.replace(['\r', '\n'], ""));
    s.push_str("\n\n");
    s.into_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_head() {
        let raw = b"POST /api/rpc?x=1 HTTP/1.1\r\nHost: 10.0.0.2:4000\r\nContent-Length: 12\r\nAuthorization: Bearer dev.a.b:snl_x\r\n\r\n";
        let end = head_end(raw).unwrap();
        assert_eq!(end, raw.len());
        let h = parse_head(&raw[..end]).unwrap();
        assert_eq!((h.method.as_str(), h.path.as_str()), ("POST", "/api/rpc"));
        assert_eq!(h.content_length(), Some(12));
        assert_eq!(h.bearer(), Some(("dev.a.b", "snl_x")));
    }

    #[test]
    fn refuses_odd_heads() {
        assert!(parse_head(b"GET http://evil/ HTTP/1.1\r\n\r\n").is_none());
        assert!(parse_head(b"GET / SPDY\r\n\r\n").is_none());
        assert!(parse_head(b"GET / HTTP/1.1\r\nno colon\r\n\r\n").is_none());
        assert!(parse_head("GET /\u{e9} HTTP/1.1\r\n\r\n".as_bytes()).is_none());
        let chunked = parse_head(b"POST / HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n").unwrap();
        assert_eq!(chunked.content_length(), None);
        let bad = parse_head(b"POST / HTTP/1.1\r\nContent-Length: -1\r\n\r\n").unwrap();
        assert_eq!(bad.content_length(), None);
        assert!(head_end(b"GET / HTTP/1.1\r\n").is_none());
    }

    #[test]
    fn only_ip_hosts_pass() {
        let h = |v: &str| Head { method: "GET".into(), path: "/".into(), headers: vec![("host".into(), v.into())] };
        assert!(h("192.168.1.10:48765").host_is_ip());
        assert!(h("192.168.1.10").host_is_ip());
        assert!(h("[fe80::1]:48765").host_is_ip());
        assert!(h("[::1]").host_is_ip());
        assert!(!h("evil.example:48765").host_is_ip());
        assert!(!h("evil.example").host_is_ip());
        assert!(!h("192.168.1.10:port").host_is_ip());
        assert!(!h("[::1]x").host_is_ip());
        assert!(!Head { method: "GET".into(), path: "/".into(), headers: vec![] }.host_is_ip());
    }

    #[test]
    fn bearer_needs_both_parts() {
        let h = |v: &str| Head { method: "GET".into(), path: "/".into(), headers: vec![("authorization".into(), v.into())] };
        assert_eq!(h("Basic abc").bearer(), None);
        assert_eq!(h("Bearer onlytoken").bearer(), None);
    }

    #[test]
    fn events_stay_on_one_line() {
        assert_eq!(event(Some("hello"), "{\"a\":\n1}"), b"event: hello\ndata: {\"a\":1}\n\n");
        let r = String::from_utf8(json(404, &serde_json::json!({}))).unwrap();
        assert!(r.starts_with("HTTP/1.1 404 Not Found\r\n") && r.contains("Content-Length: 2\r\n") && r.ends_with("\r\n\r\n{}"));
    }
}
