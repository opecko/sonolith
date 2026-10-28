import { describe, expect, it } from "vitest";
import { HANDOVER_LEAD_MS, handoverIn, learnLead, MAX_LEAD_MS, MIN_LEAD_MS, shouldPrepare } from "./gapless";

const song = { duration: 200, eligible: true };

describe("shouldPrepare", () => {
  it("prepares the next song from 80 % on, or seeking there", () => {
    expect(shouldPrepare({ ...song, position: 150 })).toBe(false);
    expect(shouldPrepare({ ...song, position: 160 })).toBe(true);
  });

  it("prepares early enough for short songs", () => {
    expect(shouldPrepare({ ...song, duration: 60, position: 41 })).toBe(true); // 80 % would be 48 s
  });

  it("never for episodes / live / repeat one, or without a length", () => {
    expect(shouldPrepare({ ...song, eligible: false, position: 190 })).toBe(false);
    expect(shouldPrepare({ ...song, duration: Infinity, position: 190 })).toBe(false);
    expect(shouldPrepare({ ...song, duration: 0, position: 0 })).toBe(false);
  });
});

describe("handoverIn", () => {
  it("is timed only within the last second, a little before the end", () => {
    expect(handoverIn({ ...song, position: 198 })).toBeNull();
    expect(handoverIn({ ...song, position: 199.5 })).toBeCloseTo(500 - HANDOVER_LEAD_MS);
    expect(handoverIn({ ...song, position: 200 })).toBe(0);
  });

  it("follows the playback rate and eligibility", () => {
    expect(handoverIn({ ...song, position: 199.5 }, 2)).toBeCloseTo(250 - HANDOVER_LEAD_MS);
    expect(handoverIn({ ...song, eligible: false, position: 199.9 })).toBeNull();
  });
});

describe("learnLead", () => {
  it("moves toward the measured start time, within bounds", () => {
    expect(handoverIn({ ...song, position: 199.5 }, 1, 300)).toBeCloseTo(200);
    expect(learnLead(150, 250)).toBe(200);
    expect(learnLead(150, 5000)).toBe(MAX_LEAD_MS);
    expect(learnLead(30, 0)).toBe(MIN_LEAD_MS);
  });
});
