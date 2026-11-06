import { describe, expect, it } from "vitest";
import { Breaker, DEFAULT_AGE_MS, expiresAt, MAX_AGE_MS, StreamCache } from "./streamCache";

const flush = () => new Promise((r) => setTimeout(r, 0));
type S = { url: string; origin?: string; live?: boolean };

describe("expiresAt", () => {
  it("reads googlevideo's expire with a margin, capped", () => {
    const now = 1_800_000_000_000;
    expect(expiresAt(`https://rr1.googlevideo.com/videoplayback?expire=${now / 1000 + 6 * 3600}&ei=x`, now)).toBe(now + MAX_AGE_MS);
    expect(expiresAt(`https://x/videoplayback?a=1&expire=${now / 1000 + 3600}`, now)).toBe(now + 50 * 60_000);
    expect(expiresAt("http://127.0.0.1:1234/s/abc", now)).toBe(now + DEFAULT_AGE_MS);
    expect(expiresAt(undefined, now)).toBe(now + DEFAULT_AGE_MS);
  });
});

describe("StreamCache", () => {
  it("shares a running resolution and reuses the result until it expires", async () => {
    const c = new StreamCache<S>();
    let t = 0;
    const p = Promise.resolve({ url: "u", origin: "https://x/v?expire=3600" });
    c.put("a", p, () => t);
    expect(c.get("a", 0)).toBe(p); // still running: shared
    await flush();
    expect(c.get("a", 1000)).toBe(p);
    t = 0;
    expect(c.get("a", 3_600_000)).toBeNull(); // past expire − 10 min
  });

  it("drops failures and live streams", async () => {
    const c = new StreamCache<S>();
    c.put("bad", Promise.reject(new Error("x")), () => 0).catch(() => {});
    c.put("live", Promise.resolve({ url: "l", live: true }), () => 0);
    await flush();
    expect(c.get("bad", 1)).toBeNull();
    expect(c.get("live", 1)).toBeNull();
  });

  it("a newer resolution replaces the old one, and delete forgets", async () => {
    const c = new StreamCache<S>();
    let resolveOld!: (s: S) => void;
    c.put("a", new Promise<S>((r) => (resolveOld = r)), () => 0);
    const fresh = Promise.resolve({ url: "new" });
    c.put("a", fresh, () => 0);
    resolveOld({ url: "old", live: true });
    await flush();
    expect(c.get("a", 1)).toBe(fresh);
    c.delete("a");
    expect(c.get("a", 1)).toBeNull();
  });
});

describe("Breaker", () => {
  it("opens after two failures in a row for a while, and closes on success", () => {
    const b = new Breaker(2, 1000);
    b.failed(0);
    expect(b.open(0)).toBe(false);
    b.failed(10);
    expect(b.open(500)).toBe(true);
    expect(b.open(1010)).toBe(false);
    b.failed(2000);
    b.succeeded();
    b.failed(2001);
    expect(b.open(2002)).toBe(false);
  });
});
