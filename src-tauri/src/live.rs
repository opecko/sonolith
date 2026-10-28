//! Live streams (YouTube Music's live stations) as one endless audio stream, like internet radio. They only come
//! as HLS, which WebKitGTK's <audio> refuses (MediaError 4 even with GStreamer's HLS demuxer installed). Their
//! audio-only rendition is a playlist of ~5 s segments, each an ID3 tag (a timestamp) and ADTS AAC, so the proxy
//! polls the playlist, fetches each new segment in order and writes it without its ID3 tag: a plain `audio/aac`
//! stream every webview plays. It starts a few segments behind the live edge (something to buffer) and ends when
//! the player closes the connection.
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use tauri_plugin_http::reqwest;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpStream;

/// Segments behind the live edge to start from (~15 s), so playback has a buffer from the first second.
const START_BEHIND: usize = 3;
/// Playlist fetches that may fail in a row before the stream ends (the player then moves on).
const MAX_FAILURES: u32 = 5;

/// For each local live stream (by its id): the sequence number of the segment it started with, and the segment length.
/// A live video starts at the segment matching the audio's position, which needs to know where the audio began
/// (segments share sequence numbers across a broadcast's renditions).
static STARTS: Mutex<Option<HashMap<String, (u64, u64)>>> = Mutex::new(None);

/// Where the local live stream `id` started: (sequence number, segment seconds); None before its first segment.
pub(crate) fn started_at(id: &str) -> Option<(u64, u64)> {
    STARTS.lock().unwrap().as_ref()?.get(id).copied()
}

/// A media playlist: the sequence number of its first segment, the target segment length and the segment URLs.
#[derive(Debug, PartialEq)]
pub(crate) struct MediaPlaylist {
    pub first_seq: u64,
    pub target_secs: u64,
    pub segments: Vec<String>,
}

pub(crate) fn parse_playlist(text: &str) -> MediaPlaylist {
    let mut first_seq = 0;
    let mut target_secs = 5;
    let mut segments = Vec::new();
    for line in text.lines().map(str::trim) {
        if let Some(v) = line.strip_prefix("#EXT-X-MEDIA-SEQUENCE:") {
            first_seq = v.parse().unwrap_or(0);
        } else if let Some(v) = line.strip_prefix("#EXT-X-TARGETDURATION:") {
            target_secs = v.parse().unwrap_or(5);
        } else if !line.is_empty() && !line.starts_with('#') {
            segments.push(line.to_owned());
        }
    }
    MediaPlaylist { first_seq, target_secs, segments }
}

/// The segment bytes without leading ID3v2 tags (header + syncsafe size, plus a footer when flagged).
pub(crate) fn strip_id3(mut data: &[u8]) -> &[u8] {
    while data.len() >= 10 && &data[..3] == b"ID3" {
        let size = data[6..10].iter().fold(0usize, |acc, b| (acc << 7) | (*b as usize & 0x7f));
        let footer = if data[5] & 0x10 != 0 { 10 } else { 0 };
        let end = 10 + size + footer;
        if end > data.len() {
            break;
        }
        data = &data[end..];
    }
    data
}

/// What the stream is, from its first segment: ADTS AAC, or MPEG-TS (a muxed variant, when there's no audio-only one).
pub(crate) fn content_type(segment: &[u8]) -> &'static str {
    if segment.first() == Some(&0x47) {
        "video/mp2t"
    } else {
        "audio/aac"
    }
}

/// Which segments of a fetched playlist are new: from `next` on (or, on the first fetch, `START_BEHIND` from the
/// end). Returns their indexes in `segments` and the next sequence number to wait for.
pub(crate) fn new_segments(p: &MediaPlaylist, next: Option<u64>) -> (std::ops::Range<usize>, u64) {
    let len = p.segments.len();
    let last = p.first_seq + len as u64; // one past the newest
    let from = match next {
        // A gap (we fell behind the playlist's window): carry on from the oldest segment still listed.
        Some(n) if n >= p.first_seq => (n - p.first_seq).min(len as u64) as usize,
        Some(_) => 0,
        None => len.saturating_sub(START_BEHIND),
    };
    (from..len, last.max(next.unwrap_or(0)))
}

/// Streams the live playlist at `url` to the player until it hangs up or the playlist stops answering, from segment
/// `from` when given (waiting for it if it isn't out yet), else a few behind the live edge.
pub(crate) async fn serve(mut sock: TcpStream, client: reqwest::Client, url: String, id: String, from: Option<u64>, head_only: bool, allowed: fn(&str) -> bool) -> Result<(), String> {
    let mut next: Option<u64> = from;
    let mut failures = 0;
    let mut started = false;
    loop {
        let playlist = match client.get(&url).send().await {
            Ok(r) if r.status().is_success() => r.text().await.ok().map(|t| parse_playlist(&t)),
            _ => None,
        };
        let Some(playlist) = playlist else {
            failures += 1;
            if failures >= MAX_FAILURES {
                if !started {
                    let _ = sock.write_all(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
                }
                return Err("live playlist stopped answering".into());
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
            continue;
        };
        failures = 0;
        let (range, after) = new_segments(&playlist, next);
        for (i, seg) in playlist.segments.iter().enumerate().take(range.end).skip(range.start) {
            if !allowed(seg) {
                continue;
            }
            let Ok(bytes) = client.get(seg).timeout(Duration::from_secs(20)).send().await.and_then(|r| r.error_for_status()) else { continue };
            let Ok(bytes) = bytes.bytes().await else { continue };
            let audio = strip_id3(&bytes);
            if !started {
                started = true;
                STARTS.lock().unwrap().get_or_insert_with(HashMap::new).insert(id.clone(), (playlist.first_seq + i as u64, playlist.target_secs));
                eprintln!("live {id}: from segment {} ({})", playlist.first_seq + i as u64, content_type(audio));
                let head = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
                    content_type(audio)
                );
                if sock.write_all(head.as_bytes()).await.is_err() || head_only {
                    return Ok(());
                }
            }
            if sock.write_all(audio).await.is_err() {
                return Ok(()); // the player closed the connection (pause for long, track change)
            }
        }
        next = Some(after);
        // Half a segment: a new one is picked up soon after it's listed, without polling hard.
        tokio::time::sleep(Duration::from_millis(playlist.target_secs.max(2) * 500)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PLAYLIST: &str = "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:5\n#EXT-X-MEDIA-SEQUENCE:100\n#EXTINF:5.0,\nhttps://a.googlevideo.com/sq/100\n#EXT-X-DISCONTINUITY\n#EXTINF:5.0,\nhttps://a.googlevideo.com/sq/101\n#EXTINF:5.0,\nhttps://a.googlevideo.com/sq/102\n#EXTINF:5.0,\nhttps://a.googlevideo.com/sq/103\n#EXTINF:5.0,\nhttps://a.googlevideo.com/sq/104\n";

    #[test]
    fn parses_media_playlist() {
        let p = parse_playlist(PLAYLIST);
        assert_eq!((p.first_seq, p.target_secs, p.segments.len()), (100, 5, 5));
        assert_eq!(p.segments[1], "https://a.googlevideo.com/sq/101");
    }

    #[test]
    fn picks_new_segments() {
        let p = parse_playlist(PLAYLIST);
        // First fetch: a few behind the edge.
        assert_eq!(new_segments(&p, None), (2..5, 105));
        // Asked to start ahead of the playlist: wait for it.
        assert_eq!(new_segments(&p, Some(107)), (5..5, 107));
        // Later: only what's new; nothing when caught up.
        assert_eq!(new_segments(&p, Some(103)), (3..5, 105));
        assert_eq!(new_segments(&p, Some(105)), (5..5, 105));
        // Fell out of the window: from the oldest listed.
        assert_eq!(new_segments(&p, Some(90)), (0..5, 105));
    }

    #[test]
    fn strips_id3_tags() {
        let mut seg = b"ID3\x03\x00\x00\x00\x00\x00\x03abc".to_vec();
        seg.extend_from_slice(&[0xff, 0xf1, 0x50]);
        assert_eq!(strip_id3(&seg), &[0xff, 0xf1, 0x50]);
        assert_eq!(strip_id3(&[0xff, 0xf1]), &[0xff, 0xf1]);
        // A truncated tag is left alone rather than cutting into nothing.
        assert_eq!(strip_id3(b"ID3\x03\x00\x00\x00\x00\x7f\x7fab").len(), 12);
        assert_eq!(content_type(&[0xff, 0xf1]), "audio/aac");
        assert_eq!(content_type(&[0x47, 0x40]), "video/mp2t");
    }
}
