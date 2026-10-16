import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** A fake frame clock and document, installed before the engine module loads (as in motion/engine.test.ts). */
function fakeDom() {
  let queue: ((t: number) => void)[] = [];
  let now = 0;
  const listeners: Record<string, (() => void)[]> = {};
  const doc = { hidden: false, addEventListener: (t: string, f: () => void) => (listeners[t] ??= []).push(f) };
  const clock = {
    requested: 0,
    raf: (f: (t: number) => void) => (clock.requested++, queue.push(f), queue.length),
    /** Runs frames for `ms` at 60 fps; returns how many frames had work queued. */
    run(ms: number) {
      let busy = 0;
      for (let end = now + ms; now < end; ) {
        now += 1000 / 60;
        const q = queue;
        queue = [];
        if (q.length) busy++;
        for (const f of q) f(now);
      }
      return busy;
    },
    pending: () => queue.length,
    setHidden(h: boolean) {
      doc.hidden = h;
      for (const f of listeners.visibilitychange ?? []) f();
    },
  };
  vi.stubGlobal("document", doc);
  vi.stubGlobal("requestAnimationFrame", clock.raf);
  vi.stubGlobal("cancelAnimationFrame", () => (queue = []));
  return clock;
}

describe("PushPanel", () => {
  let clock: ReturnType<typeof fakeDom>;
  let mod: typeof import("./pushPanel");
  let engine: typeof import("../../motion/engine");
  const W = 420;
  beforeEach(async () => {
    vi.resetModules();
    clock = fakeDom();
    engine = await import("../../motion/engine");
    mod = await import("./pushPanel");
  });
  afterEach(() => vi.unstubAllGlobals());

  function setup() {
    const frames: number[] = [];
    const views: import("./pushPanel").PanelView[] = [];
    const panel = new mod.PushPanel(W, (px) => frames.push(px), (v) => views.push(v));
    /** Largest change between two painted frames: a jump shows up as a big one. */
    const maxStep = () => frames.slice(1).reduce((m, f, i) => Math.max(m, Math.abs(f - frames[i])), 0);
    return { panel, frames, views, maxStep };
  }

  it("opens and closes with whole-pixel frames, ending exactly at the edges", () => {
    const { panel, frames, views } = setup();
    panel.setTarget("upnext");
    expect(views.at(-1)).toEqual({ mounted: true, tab: "upnext" });
    clock.run(1500);
    expect(frames.every(Number.isInteger)).toBe(true);
    expect(frames.at(-1)).toBe(W);
    panel.setTarget(null);
    clock.run(1500);
    expect(frames.at(-1)).toBe(0);
    expect(views.at(-1)).toEqual({ mounted: false, tab: "upnext" });
  });

  it("20 toggles within a few ms end in the latest target, without a stale unmount", () => {
    const { panel, views, frames, maxStep } = setup();
    for (let i = 0; i < 20; i++) {
      panel.setTarget(i % 2 ? null : "upnext");
      clock.run(1); // a frame every now and then, as real input would land
    }
    // Last call (i = 19) closed it.
    clock.run(1500);
    expect(frames.at(-1)).toBe(0);
    expect(views.at(-1)?.mounted).toBe(false);
    // An odd count: open again; it must arrive and stay mounted.
    panel.setTarget("related");
    clock.run(1500);
    expect(frames.at(-1)).toBe(W);
    expect(views.at(-1)).toEqual({ mounted: true, tab: "related" });
    expect(maxStep()).toBeLessThan(W / 3);
    expect(clock.pending()).toBe(0);
  });

  it("open → close mid-flight → open: retargets from where it is, never back to an edge, never unmounts", () => {
    const { panel, frames, views, maxStep } = setup();
    panel.setTarget("upnext");
    clock.run(80);
    const mid = frames.at(-1)!;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(W);
    panel.setTarget(null);
    clock.run(50);
    const back = frames.at(-1)!;
    panel.setTarget("upnext");
    clock.run(1500);
    // Continuous: the frames right after each retarget sit next to the previous ones.
    expect(maxStep()).toBeLessThan(W / 3);
    expect(Math.min(...frames.slice(frames.indexOf(back)))).toBeGreaterThan(0);
    expect(frames.at(-1)).toBe(W);
    expect(views.some((v) => !v.mounted)).toBe(false);
  });

  it("queue → related → close: the switch swaps content without restarting the slide", () => {
    const { panel, frames, views } = setup();
    panel.setTarget("upnext");
    clock.run(60);
    const n = frames.length;
    panel.setTarget("related");
    expect(views.at(-1)).toEqual({ mounted: true, tab: "related" });
    clock.run(1500);
    // Still opening monotonically after the switch: no restart from 0.
    const after = frames.slice(n - 1);
    expect(after.every((f, i) => i === 0 || f >= after[i - 1])).toBe(true);
    panel.setTarget(null);
    clock.run(1500);
    expect(frames.at(-1)).toBe(0);
    // Closing keeps the last content on the way out.
    expect(views.at(-1)).toEqual({ mounted: false, tab: "related" });
  });

  it("switching tabs while fully open paints nothing", () => {
    const { panel, frames } = setup();
    panel.setTarget("upnext");
    clock.run(1500);
    const n = frames.length;
    panel.setTarget("lyrics");
    panel.setTarget("related");
    clock.run(500);
    expect(frames.length).toBe(n);
  });

  it("with animations off every change lands at once", () => {
    engine.setMotionEnabled(false);
    const { panel, frames, views } = setup();
    panel.setTarget("upnext");
    expect(frames.at(-1)).toBe(W);
    panel.setTarget(null);
    expect(frames.at(-1)).toBe(0);
    expect(views.at(-1)?.mounted).toBe(false);
    expect(clock.requested).toBe(0);
  });

  it("a resize while open follows the new width", () => {
    const { panel, frames } = setup();
    panel.setTarget("upnext");
    clock.run(1500);
    panel.setWidth(380);
    expect(frames.at(-1)).toBe(380);
    expect(panel.px).toBe(380);
  });
});
