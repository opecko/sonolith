import { describe, expect, it } from "vitest";
import { MAX_NUDGE, SEEK_COOLDOWN_S, SEEK_LEAD_S, videoSync, type SyncInput } from "./videoSync";

const base: SyncInput = { audioTime: 60, audioRate: 1, audioPlaying: true, videoTime: 60, videoBusy: false, sinceSeek: Infinity };

describe("videoSync", () => {
  it("plays along when in sync", () => {
    expect(videoSync(base)).toEqual({ rate: 1, play: true });
  });

  it("catches up small drift by rate, not by seeking", () => {
    const behind = videoSync({ ...base, videoTime: 59.6 });
    expect(behind.seek).toBeUndefined();
    expect(behind.rate).toBeGreaterThan(1);
    const ahead = videoSync({ ...base, videoTime: 60.5 });
    expect(ahead.seek).toBeUndefined();
    expect(ahead.rate).toBeLessThan(1);
    expect(videoSync({ ...base, videoTime: 59.15 }).rate).toBeLessThanOrEqual(1 + MAX_NUDGE);
  });

  it("follows the audio's own speed (podcasts)", () => {
    expect(videoSync({ ...base, audioRate: 1.5 }).rate).toBe(1.5);
    expect(videoSync({ ...base, audioRate: 1.5, videoTime: 59.6 }).rate).toBeGreaterThan(1.5);
  });

  it("seeks ahead of the audio when far off", () => {
    expect(videoSync({ ...base, videoTime: 10 }).seek).toBeCloseTo(60 + SEEK_LEAD_S);
  });

  it("does not seek again while a seek is landing or too soon", () => {
    expect(videoSync({ ...base, videoTime: 10, videoBusy: true }).seek).toBeUndefined();
    expect(videoSync({ ...base, videoTime: 10, sinceSeek: SEEK_COOLDOWN_S / 2 }).seek).toBeUndefined();
    expect(videoSync({ ...base, videoTime: 10, sinceSeek: SEEK_COOLDOWN_S + 0.1 }).seek).toBeDefined();
  });

  it("seeks at once when forced (the user seeked), even mid-seek", () => {
    expect(videoSync({ ...base, videoTime: 59.9, force: true, sinceSeek: 0.1 }).seek).toBeCloseTo(60 + SEEK_LEAD_S);
  });

  it("stands still exactly at the audio position while paused", () => {
    expect(videoSync({ ...base, audioPlaying: false, videoTime: 30 })).toEqual({ rate: 1, play: false, seek: 60 });
    expect(videoSync({ ...base, audioPlaying: false })).toEqual({ rate: 1, play: false, seek: undefined });
    expect(videoSync({ ...base, audioPlaying: false, videoTime: 30, videoBusy: true }).seek).toBeUndefined();
  });

  it("never aims past the video's end", () => {
    expect(videoSync({ ...base, audioTime: 200, videoTime: 10, videoDuration: 180 }).seek).toBeLessThan(180);
  });
});
