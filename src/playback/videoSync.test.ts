import { describe, expect, it } from "vitest";
import { MAX_LEAD_S, MIN_LEAD_S, nextLead, SEEK_COOLDOWN_S, videoSync, type SyncInput } from "./videoSync";

const base: SyncInput = { audioTime: 60, audioRate: 1, audioPlaying: true, videoTime: 60, videoBusy: false, sinceSeek: Infinity, lead: 0.2 };

describe("videoSync", () => {
  it("plays along at the audio's rate when in sync", () => {
    expect(videoSync(base)).toEqual({ rate: 1, play: true });
    expect(videoSync({ ...base, audioRate: 1.5 }).rate).toBe(1.5);
  });

  it("never changes the rate to catch up (a rate change blinks on WebKitGTK)", () => {
    for (const videoTime of [59.9, 59.8, 60.2, 50]) expect(videoSync({ ...base, videoTime }).rate).toBe(1);
  });

  it("lets small drift be", () => {
    expect(videoSync({ ...base, videoTime: 59.85 }).seek).toBeUndefined();
    expect(videoSync({ ...base, videoTime: 60.2 }).seek).toBeUndefined();
  });

  it("seeks ahead by the measured lead when off", () => {
    expect(videoSync({ ...base, videoTime: 59 }).seek).toBeCloseTo(60.2);
    expect(videoSync({ ...base, videoTime: 59, audioRate: 1.5 }).seek).toBeCloseTo(60.3);
  });

  it("does not seek again while a seek is landing or too soon", () => {
    expect(videoSync({ ...base, videoTime: 10, videoBusy: true }).seek).toBeUndefined();
    expect(videoSync({ ...base, videoTime: 10, sinceSeek: SEEK_COOLDOWN_S / 2 }).seek).toBeUndefined();
    expect(videoSync({ ...base, videoTime: 10, sinceSeek: SEEK_COOLDOWN_S + 0.1 }).seek).toBeDefined();
  });

  it("seeks at once when forced (the user seeked), even mid-seek", () => {
    expect(videoSync({ ...base, videoTime: 59.9, force: true, sinceSeek: 0.1, videoBusy: true }).seek).toBeCloseTo(60.2);
  });

  it("stands still at the audio position while paused", () => {
    expect(videoSync({ ...base, audioPlaying: false, videoTime: 30 })).toEqual({ rate: 1, play: false, seek: 60 });
    expect(videoSync({ ...base, audioPlaying: false })).toEqual({ rate: 1, play: false, seek: undefined });
    expect(videoSync({ ...base, audioPlaying: false, videoTime: 30, videoBusy: true }).seek).toBeUndefined();
  });

  it("never aims past the video's end", () => {
    expect(videoSync({ ...base, audioTime: 200, videoTime: 10, videoDuration: 180 }).seek).toBeLessThan(180);
  });
});

describe("nextLead", () => {
  it("follows measured seek times, bounded", () => {
    expect(nextLead(0.2, 0.6)).toBeCloseTo(0.4);
    expect(nextLead(0.2, 10)).toBe(MAX_LEAD_S);
    expect(nextLead(0.05, 0)).toBe(MIN_LEAD_S);
  });
});
