import { describe, expect, it } from "vitest";
import { cooldown, FIRST_GUESS, learn, MAX_LEAD_S, SEEK_COOLDOWN_S, tolerance, videoSync, type SyncInput } from "./videoSync";

const base: SyncInput = { audioTime: 60, audioRate: 1, audioPlaying: true, videoTime: 60, videoBusy: false, sinceSeek: Infinity, learnt: FIRST_GUESS };

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

describe("learning where seeks land", () => {
  it("aims further ahead after landing behind, less after landing ahead", () => {
    expect(learn(FIRST_GUESS, 0.5).lead).toBeGreaterThan(FIRST_GUESS.lead);
    expect(learn(FIRST_GUESS, -0.1).lead).toBeLessThan(FIRST_GUESS.lead);
    expect(learn(FIRST_GUESS, 10).lead).toBe(MAX_LEAD_S);
  });

  it("backs off after misses instead of seeking (and blinking) forever, and recovers after a good landing", () => {
    let l = FIRST_GUESS;
    for (let k = 0; k < 3; k++) l = learn(l, 0.8);
    expect(l.misses).toBe(3);
    expect(tolerance(l)).toBeGreaterThan(tolerance(FIRST_GUESS));
    expect(cooldown(l)).toBeGreaterThan(SEEK_COOLDOWN_S);
    expect(videoSync({ ...base, videoTime: 59.2, learnt: l }).seek).toBeUndefined();
    expect(learn(l, 0.05).misses).toBe(0);
  });

  it("converges when seeks land a steady amount late", () => {
    // The video always resumes `late` seconds after where it was sent, relative to the audio.
    const late = 0.6;
    let l = FIRST_GUESS;
    let behind = 0;
    for (let k = 0; k < 6; k++) {
      behind = late - l.lead;
      l = learn(l, behind);
    }
    expect(Math.abs(late - l.lead)).toBeLessThan(0.05);
  });
});
