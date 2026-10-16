import { settled, springAt, SPRINGS, type SpringParams, type SpringPreset } from "./spring";

/**
 * One requestAnimationFrame loop for every animation in the app. Animations write styles straight to elements
 * through their `onUpdate` (no React state per frame). The central switch: with animations off, or while the
 * window is hidden, nothing animates — every animation jumps to its end state and the loop doesn't run.
 */
interface Running {
  /** Advances to `now` (ms); returns true when finished. */
  step(now: number): boolean;
  /** Jumps to the end state. */
  finish(): void;
}

let enabled = true;
const running = new Set<Running>();
let raf = 0;

const hasDom = typeof document !== "undefined" && typeof requestAnimationFrame === "function";
const hidden = () => hasDom && document.hidden;

/** Whether animations run right now: the setting is on, the window is visible and there's a frame clock. */
export const motionOn = () => enabled && hasDom && !hidden();

/** Animations setting (main.tsx keeps it in sync); turning it off finishes everything in flight. */
export function setMotionEnabled(on: boolean) {
  enabled = on;
  if (!on) finishAll();
}

function finishAll() {
  const all = [...running];
  running.clear();
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  for (const a of all) a.finish();
}

function frame(now: number) {
  raf = 0;
  for (const a of [...running]) if (a.step(now)) running.delete(a);
  if (running.size) raf = requestAnimationFrame(frame);
}

function start(a: Running) {
  running.add(a);
  if (!raf) raf = requestAnimationFrame(frame);
}

// Hidden windows don't paint; finishing there means nothing runs (or burns CPU) until the user looks again.
if (hasDom) document.addEventListener("visibilitychange", () => hidden() && finishAll());

/** A number animated by a spring. `to()` retargets mid-flight keeping velocity; `set()` jumps. */
export class Spring {
  value: number;
  velocity = 0;
  target: number;
  private params: SpringParams;
  private seg = { t0: -1, from: 0, v0: 0 };
  private done?: () => void;
  private precision: number;
  private readonly anim: Running = {
    step: (now) => {
      if (this.seg.t0 < 0) this.seg.t0 = now;
      const { x, v } = springAt(this.params, this.seg.from, this.target, this.seg.v0, (now - this.seg.t0) / 1000);
      if (settled(x, v, this.target, this.precision)) {
        this.anim.finish();
        return true;
      }
      this.value = x;
      this.velocity = v;
      this.onUpdate(x);
      return false;
    },
    finish: () => {
      this.value = this.target;
      this.velocity = 0;
      this.onUpdate(this.target);
      const d = this.done;
      this.done = undefined;
      d?.();
    },
  };

  constructor(value: number, spring: SpringPreset | SpringParams, private onUpdate: (v: number) => void, opts: { precision?: number } = {}) {
    this.value = this.target = value;
    this.params = typeof spring === "string" ? SPRINGS[spring] : spring;
    this.precision = opts.precision ?? 0.01;
  }

  get animating() {
    return running.has(this.anim);
  }

  /** Heads for `target`; `onDone` runs once it gets there (right away when animations are off). */
  to(target: number, onDone?: () => void, spring?: SpringPreset | SpringParams) {
    if (spring) this.params = typeof spring === "string" ? SPRINGS[spring] : spring;
    this.target = target;
    this.done = onDone;
    if (!motionOn()) {
      running.delete(this.anim);
      this.anim.finish();
      return;
    }
    // New segment from where the value is now, with its current velocity.
    this.seg = { t0: -1, from: this.value, v0: this.velocity };
    if (this.value === target && this.velocity === 0) {
      running.delete(this.anim);
      this.anim.finish();
      return;
    }
    start(this.anim);
  }

  set(value: number) {
    running.delete(this.anim);
    this.done = undefined;
    this.value = this.target = value;
    this.velocity = 0;
    this.onUpdate(value);
  }

  /** Stops where it is, without calling onDone (unmount). */
  stop() {
    running.delete(this.anim);
    this.done = undefined;
  }
}

/** A fixed-duration animation from 0 to 1 through `ease` (Classic's own timings); same switch as springs. */
export function tween(ms: number, ease: (t: number) => number, onUpdate: (p: number) => void, onDone?: () => void): () => void {
  let t0 = -1;
  const anim: Running = {
    step(now) {
      if (t0 < 0) t0 = now;
      const t = Math.min(1, (now - t0) / ms);
      if (t >= 1) {
        anim.finish();
        return true;
      }
      onUpdate(ease(t));
      return false;
    },
    finish() {
      onUpdate(1);
      onDone?.();
    },
  };
  if (!motionOn()) anim.finish();
  else start(anim);
  return () => void running.delete(anim);
}
