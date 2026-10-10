/** Linux exports MPRIS natively from Rust; the webview's Media Session is used everywhere else (SMTC, Now Playing). */
export const nativeMpris = typeof navigator !== "undefined" && /Linux/.test(navigator.userAgent) && !/Android/.test(navigator.userAgent);
