import { describe, expect, it } from "vitest";
import { lowestVariant, pickHlsAudio, pickHlsVideo } from "./hls";

// Trimmed from a live station's master playlist (2026-10-28); URLs shortened.
const MASTER = `#EXTM3U
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-MEDIA:URI="https://manifest.googlevideo.com/hls_playlist/itag/233/index.m3u8",TYPE=AUDIO,GROUP-ID="233",NAME="Default",DEFAULT=YES,AUTOSELECT=YES
#EXT-X-MEDIA:URI="https://manifest.googlevideo.com/hls_playlist/itag/234/index.m3u8",TYPE=AUDIO,GROUP-ID="234",NAME="Default",DEFAULT=YES,AUTOSELECT=YES
#EXT-X-STREAM-INF:BANDWIDTH=507418,CODECS="avc1.4D4015,mp4a.40.5",RESOLUTION=426x240,FRAME-RATE=30,AUDIO="233",CLOSED-CAPTIONS=NONE
https://manifest.googlevideo.com/hls_playlist/itag/229/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=4561186,CODECS="avc1.640028,mp4a.40.2",RESOLUTION=1920x1080,FRAME-RATE=30,AUDIO="234",CLOSED-CAPTIONS=NONE
https://manifest.googlevideo.com/hls_playlist/itag/301/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=269034,CODECS="avc1.42C00B,mp4a.40.5",RESOLUTION=256x144,FRAME-RATE=15,AUDIO="233",CLOSED-CAPTIONS=NONE
https://manifest.googlevideo.com/hls_playlist/itag/269/index.m3u8
`;

describe("pickHlsAudio", () => {
  it("takes the audio group of the best variant (AAC 128 kbps)", () => {
    expect(pickHlsAudio(MASTER)).toBe("https://manifest.googlevideo.com/hls_playlist/itag/234/index.m3u8");
  });

  it("falls back to the last audio rendition, or null without any", () => {
    const noVariants = MASTER.split("\n").filter((l) => !l.startsWith("#EXT-X-STREAM-INF")).join("\n");
    expect(pickHlsAudio(noVariants)).toContain("itag/234");
    expect(pickHlsAudio("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhttps://x/v.m3u8\n")).toBeNull();
    expect(pickHlsAudio("")).toBeNull();
  });

  it("reads Windows line endings", () => {
    expect(pickHlsAudio(MASTER.replace(/\n/g, "\r\n"))).toContain("itag/234");
  });
});

describe("lowestVariant", () => {
  it("takes the cheapest variant", () => {
    expect(lowestVariant(MASTER)).toContain("itag/269");
    expect(lowestVariant("#EXTM3U\n")).toBeNull();
  });
});

describe("pickHlsVideo", () => {
  it("takes the best variant up to 720p, else the smallest", () => {
    expect(pickHlsVideo(MASTER)).toContain("itag/229");
    expect(pickHlsVideo(MASTER, 100)).toContain("itag/269");
    expect(pickHlsVideo("#EXTM3U\n")).toBeNull();
  });
});
