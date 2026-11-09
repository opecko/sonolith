//! The pairing link as a QR code: an SVG whose dark modules use `currentColor`, so Settings picks the colors.

use qrcode::{Color, QrCode};

/// Modules of light margin around the code, as the QR standard asks.
const QUIET: usize = 4;

pub fn svg(text: &str) -> Option<String> {
    let code = QrCode::new(text.as_bytes()).ok()?;
    let width = code.width();
    let colors = code.to_colors();
    let mut path = String::new();
    for y in 0..width {
        let row = &colors[y * width..(y + 1) * width];
        let mut x = 0;
        while x < width {
            if row[x] == Color::Dark {
                let start = x;
                while x < width && row[x] == Color::Dark {
                    x += 1;
                }
                path.push_str(&format!("M{} {}h{}v1h-{}z", start + QUIET, y + QUIET, x - start, x - start));
            } else {
                x += 1;
            }
        }
    }
    let size = width + 2 * QUIET;
    Some(format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" shape-rendering="crispEdges" role="img" aria-label="QR code of the pairing link"><path fill="currentColor" d="{path}"/></svg>"#
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn draws_a_square_code_with_a_margin() {
        let s = svg("http://192.168.1.10:48765/#k=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG").unwrap();
        assert!(s.starts_with("<svg ") && s.ends_with("</svg>"));
        // A version 4 code (33 modules) plus the margin on both sides.
        let size = QrCode::new(b"http://192.168.1.10:48765/#k=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG").unwrap().width() + 8;
        assert!(s.contains(&format!("viewBox=\"0 0 {size} {size}\"")));
        // The top-left finder pattern: a 7-module dark run at the margin.
        assert!(s.contains("M4 4h7v1h-7z"));
    }
}
