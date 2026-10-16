import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** A fake frame clock and document, installed before the engine module loads (it checks for them at import). */
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

describe("frame loop", () => {
  let clock: ReturnType<typeof fakeDom>;
  let engine: typeof import("./engine");
  beforeEach(async () => {
    vi.resetModules();
    clock = fakeDom();
    engine = await import("./engine");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("animates, then stops requesting frames once the spring settles", () => {
    const seen: number[] = [];
    let done = 0;
    new engine.Spring(0, "fastSpatial", (v) => seen.push(v)).to(100, () => done++);
    const busy = clock.run(3000);
    expect(seen.length).toBeGreaterThan(5);
    expect(seen.at(-1)).toBe(100);
    expect(done).toBe(1);
    // Every requested frame happened inside the settle time (< 1 s), none after it.
    expect(busy).toBeLessThan(60);
    expect(clock.pending()).toBe(0);
  });

  it("with animations off nothing is scheduled at all", () => {
    engine.setMotionEnabled(false);
    const s = new engine.Spring(0, "slowSpatial", () => {});
    s.to(50);
    const stop = engine.ticker(() => {});
    expect(s.value).toBe(50);
    expect(clock.requested).toBe(0);
    stop();
  });

  it("hiding the window finishes springs and pauses tickers; showing it resumes tickers only", () => {
    const s = new engine.Spring(0, "slowSpatial", () => {});
    s.to(100);
    let ticks = 0;
    const stop = engine.ticker(() => ticks++);
    clock.run(100);
    expect(ticks).toBeGreaterThan(0);
    clock.setHidden(true);
    expect(s.value).toBe(100);
    const before = ticks;
    expect(clock.run(1000)).toBe(0);
    expect(ticks).toBe(before);
    clock.setHidden(false);
    clock.run(100);
    expect(ticks).toBeGreaterThan(before);
    stop();
    clock.run(100);
    expect(clock.pending()).toBe(0);
  });

  it("retargeting mid-flight keeps the velocity (no jump back to rest)", () => {
    const seen: number[] = [];
    const s = new engine.Spring(0, "defaultSpatial", (v) => seen.push(v));
    s.to(100);
    clock.run(80);
    const v = s.velocity;
    expect(v).toBeGreaterThan(0);
    s.to(0);
    clock.run(1000 / 60);
    // Still moving up for a moment right after the retarget: momentum carried over.
    expect(seen.at(-1)!).toBeGreaterThan(seen.at(-2)!);
  });
});
