//! Minimal localhost HTTP proxy for googlevideo streams, used when WebKitGTK's <audio> can't load the
//! raw URL (403 / unsupported). Supports Range so seeking works. Only registered URLs are served.
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

use tauri_plugin_http::reqwest;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

const UA: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const MAX_ENTRIES: usize = 8;

struct Proxy {
    port: u16,
    urls: Mutex<Vec<(String, String)>>, // (id, url), newest last
}

static PROXY: OnceLock<Proxy> = OnceLock::new();
static COUNTER: AtomicU64 = AtomicU64::new(1);

fn allowed(url: &str) -> bool {
    url::Url::parse(url)
        .ok()
        .filter(|u| u.scheme() == "https")
        .and_then(|u| u.host_str().map(|h| h.ends_with(".googlevideo.com")))
        .unwrap_or(false)
}

/// Parses "GET /s/<id> HTTP/1.1" + headers. Returns (method, path, headers lowercased).
fn parse_request(raw: &str) -> Option<(String, String, HashMap<String, String>)> {
    let mut lines = raw.split("\r\n");
    let mut first = lines.next()?.split(' ');
    let method = first.next()?.to_owned();
    let path = first.next()?.to_owned();
    let headers = lines
        .take_while(|l| !l.is_empty())
        .filter_map(|l| l.split_once(':'))
        .map(|(k, v)| (k.trim().to_ascii_lowercase(), v.trim().to_owned()))
        .collect();
    Some((method, path, headers))
}

async fn start() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    tauri::async_runtime::spawn(async move {
        let client = reqwest::Client::builder().user_agent(UA).build().expect("http client");
        loop {
            let Ok((sock, _)) = listener.accept().await else {
                // A persistent error (e.g. out of file descriptors) would otherwise spin a core.
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                continue;
            };
            let client = client.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = serve(sock, client).await {
                    eprintln!("proxy: {e}");
                }
            });
        }
    });
    Ok(port)
}

async fn serve(mut sock: TcpStream, client: reqwest::Client) -> Result<(), String> {
    let mut buf = Vec::with_capacity(2048);
    let mut chunk = [0u8; 2048];
    while !buf.windows(4).any(|w| w == b"\r\n\r\n") {
        let n = sock.read(&mut chunk).await.map_err(|e| e.to_string())?;
        if n == 0 || buf.len() > 16 * 1024 {
            return Ok(());
        }
        buf.extend_from_slice(&chunk[..n]);
    }
    let raw = String::from_utf8_lossy(&buf).into_owned();
    let Some((method, path, headers)) = parse_request(&raw) else { return Ok(()) };
    let id = path.strip_prefix("/s/").unwrap_or("");
    let url = PROXY.get().and_then(|p| p.urls.lock().unwrap().iter().find(|(i, _)| i == id).map(|(_, u)| u.clone()));
    let Some(url) = url else {
        let _ = sock.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
        return Ok(());
    };
    let mut req = client.get(&url);
    if let Some(r) = headers.get("range") {
        req = req.header("Range", r);
    }
    let mut res = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            let _ = sock.write_all(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
            return Err(e.to_string());
        }
    };
    let status = res.status();
    let mut head = format!("HTTP/1.1 {} {}\r\n", status.as_u16(), status.canonical_reason().unwrap_or(""));
    for name in ["content-type", "content-length", "content-range", "last-modified", "etag"] {
        if let Some(v) = res.headers().get(name).and_then(|v| v.to_str().ok()) {
            head.push_str(&format!("{name}: {v}\r\n"));
        }
    }
    head.push_str("Accept-Ranges: bytes\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n");
    sock.write_all(head.as_bytes()).await.map_err(|e| e.to_string())?;
    if method == "HEAD" {
        return Ok(());
    }
    while let Some(bytes) = res.chunk().await.map_err(|e| e.to_string())? {
        if sock.write_all(&bytes).await.is_err() {
            break; // player closed the connection (seek / track change)
        }
    }
    Ok(())
}

/// Registers a googlevideo URL and returns a local URL that streams it with Range support.
#[tauri::command]
pub async fn proxy_url(url: String) -> Result<String, String> {
    if !allowed(&url) {
        return Err("only https googlevideo.com URLs can be proxied".into());
    }
    if PROXY.get().is_none() {
        let port = start().await?;
        let _ = PROXY.set(Proxy { port, urls: Mutex::new(Vec::new()) });
    }
    let p = PROXY.get().unwrap();
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let id = format!("{:x}{:x}", COUNTER.fetch_add(1, Ordering::Relaxed), nanos as u64);
    let mut urls = p.urls.lock().unwrap();
    urls.push((id.clone(), url));
    let excess = urls.len().saturating_sub(MAX_ENTRIES);
    urls.drain(..excess);
    Ok(format!("http://127.0.0.1:{}/s/{id}", p.port))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_googlevideo() {
        assert!(allowed("https://rr1---sn-x.googlevideo.com/videoplayback?a=1"));
        assert!(!allowed("http://rr1---sn-x.googlevideo.com/videoplayback"));
        assert!(!allowed("https://evil.com/?h=.googlevideo.com"));
        assert!(!allowed("https://googlevideo.com.evil.com/"));
    }

    #[test]
    fn parses_request() {
        let (m, p, h) = parse_request("GET /s/ab HTTP/1.1\r\nHost: x\r\nRange: bytes=10-\r\n\r\n").unwrap();
        assert_eq!((m.as_str(), p.as_str()), ("GET", "/s/ab"));
        assert_eq!(h.get("range").map(String::as_str), Some("bytes=10-"));
    }
}

/// Diagnostics for a stream URL the <audio> element rejected: what googlevideo answers to a small Range request
/// ("206 audio/webm len=1024", or the status plus the start of an error body). googlevideo URLs only.
#[tauri::command]
pub async fn stream_probe(url: String) -> Result<String, String> {
    if !allowed(&url) {
        return Err("not a googlevideo URL".into());
    }
    let res = reqwest::Client::builder()
        .user_agent(UA)
        .build()
        .map_err(|e| e.to_string())?
        .get(&url)
        .header("Range", "bytes=0-1023")
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    let status = res.status().as_u16();
    let ct = res.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("-").to_owned();
    let len = res.headers().get("content-length").and_then(|v| v.to_str().ok()).unwrap_or("-").to_owned();
    let body = res.bytes().await.map_err(|e| e.to_string())?;
    let head: String = if ct.starts_with("audio/") || ct.starts_with("video/") {
        body.iter().take(8).map(|b| format!("{b:02x}")).collect()
    } else {
        String::from_utf8_lossy(&body[..body.len().min(160)]).replace(['\n', '\r'], " ")
    };
    Ok(format!("{status} {ct} len={len} head={head}"))
}
