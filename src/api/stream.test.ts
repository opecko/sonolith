import { describe, expect, it } from "vitest";
import { supportedCodecs } from "./stream";

describe("supportedCodecs", () => {
  it("prefers opus, filters by canPlayType", () => {
    expect(supportedCodecs(() => "maybe")).toEqual(["opus", "aac"]);
    expect(supportedCodecs((m) => (m.includes("mp4") ? "probably" : ""))).toEqual(["aac"]);
    expect(supportedCodecs(() => "")).toEqual([]);
  });
});

import { pickVideoFormat } from "./stream";

it("picks H.264 up to 720p30 for the video track", () => {
  const f = (itag: number, height: number, fps: number, codec: string) => ({ itag, height, fps, mime_type: `video/${codec === "vp9" ? "webm" : "mp4"}; codecs="${codec}"` });
  const all = [f(299, 1080, 60, "avc1.64002a"), f(303, 1080, 60, "vp9"), f(298, 720, 60, "avc1.4d4020"), f(136, 720, 30, "avc1.4d401f"), f(135, 480, 30, "avc1.4d401e"), f(247, 720, 30, "vp9")];
  expect(pickVideoFormat(all)?.itag).toBe(136);
  expect(pickVideoFormat([f(303, 1080, 60, "vp9"), f(247, 720, 30, "vp9")])?.itag).toBe(247);
  expect(pickVideoFormat([])).toBeUndefined();
});
