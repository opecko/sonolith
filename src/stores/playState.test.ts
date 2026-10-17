import { describe, expect, it } from "vitest";
import { pipelineStuck, reconcileStatus, toggleAction } from "./playState";

const playingEl = { paused: false, ended: false };
const pausedEl = { paused: true, ended: false };

describe("play state follows the <audio> element", () => {
  it("the reported bug: the store says paused while the element plays → back to playing", () => {
    expect(reconcileStatus("paused", playingEl)).toBe("playing");
  });

  it("the store says playing while the element is paused → paused", () => {
    expect(reconcileStatus("playing", pausedEl)).toBe("paused");
  });

  it("agreeing states, an ended track and load / failure states are left alone", () => {
    expect(reconcileStatus("playing", playingEl)).toBeNull();
    expect(reconcileStatus("paused", pausedEl)).toBeNull();
    expect(reconcileStatus("playing", { paused: true, ended: true })).toBeNull();
    for (const s of ["loading", "idle", "error"] as const) {
      expect(reconcileStatus(s, playingEl)).toBeNull();
      expect(reconcileStatus(s, pausedEl)).toBeNull();
    }
  });

  it("toggling decides by the element, even when the status is stale", () => {
    // Stale "paused" over a playing element: the toggle pauses (before: it called play(), a no-op, forever).
    expect(toggleAction("paused", playingEl, true)).toBe("pause");
    expect(toggleAction("playing", pausedEl, true)).toBe("play");
    expect(toggleAction("playing", playingEl, true)).toBe("pause");
    expect(toggleAction("paused", pausedEl, true)).toBe("play");
  });

  it("toggling an errored or restored-idle track restarts it; nothing to play does nothing", () => {
    expect(toggleAction("error", pausedEl, true)).toBe("restart");
    expect(toggleAction("idle", pausedEl, true)).toBe("restart");
    expect(toggleAction("idle", pausedEl, false)).toBeNull();
    expect(toggleAction("loading", pausedEl, true)).toBeNull();
  });

  it("a rapid pause / play / seek sequence with late events ends in agreement", () => {
    // Element truth after each user action, and the (late) status the events would have left.
    let status: "playing" | "paused" = "playing";
    const el = { paused: false, ended: false };
    const steps: [boolean, "playing" | "paused"][] = [[true, "playing"], [false, "paused"], [true, "paused"], [false, "paused"], [true, "playing"]];
    for (const [paused, lateStatus] of steps) {
      el.paused = paused;
      status = lateStatus;
      status = (reconcileStatus(status, el) as typeof status | null) ?? status;
      expect(status).toBe(paused ? "paused" : "playing");
    }
  });

  it("time moving on a paused element means the pipeline didn't stop", () => {
    expect(pipelineStuck(pausedEl, 2.5)).toBe(true);
    expect(pipelineStuck(pausedEl, 0.3)).toBe(false);
    expect(pipelineStuck(playingEl, 5)).toBe(false);
  });
});
