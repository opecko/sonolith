import { describe, expect, it } from "vitest";
// @ts-expect-error: a plain JS module served to the phone as is.
import { artistLine, backoff, failureText, formatTime, parseEvents, positionNow, secretFromHash } from "./logic.js";

describe("phone remote page logic", () => {
  it("formats times", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(61_500)).toBe("1:01");
    expect(formatTime(3_725_000)).toBe("1:02:05");
    expect(formatTime(-5)).toBe("0:00");
  });

  it("takes the secret only from a well-formed fragment", () => {
    expect(secretFromHash("#k=abcdefghijklmnop_-12")).toBe("abcdefghijklmnop_-12");
    expect(secretFromHash("#k=short")).toBeNull();
    expect(secretFromHash("#k=abcdefghijklmnopq&x=1")).toBeNull();
    expect(secretFromHash("")).toBeNull();
  });

  it("splits events across chunks and skips keepalives", () => {
    const a = parseEvents('event: hello\ndata: {"a":1}\n\n: keepalive\n\ndata: {"b"');
    expect(a.events).toEqual([{ name: "hello", data: '{"a":1}' }]);
    const b = parseEvents(a.rest + ":2}\n\n");
    expect(b.events).toEqual([{ name: "message", data: '{"b":2}' }]);
    expect(b.rest).toBe("");
  });

  it("moves the position on only while playing, up to the duration", () => {
    const p = { positionMs: 10_000, receivedAt: 1000, durationMs: 12_000, status: "playing", rate: 1 };
    expect(positionNow(p, 2000)).toBe(11_000);
    expect(positionNow(p, 9000)).toBe(12_000);
    expect(positionNow({ ...p, status: "paused" }, 9000)).toBe(10_000);
    expect(positionNow(null, 1)).toBe(0);
  });

  it("names artists and failures", () => {
    expect(artistLine({ artists: [{ name: "A" }, { name: "B" }] })).toBe("A, B");
    expect(artistLine(null)).toBe("");
    expect(backoff(0)).toBe(1000);
    expect(backoff(10)).toBe(30000);
    expect(failureText("wrongLink")).toMatch(/no longer valid/);
    expect(failureText("other")).toMatch(/Can't reach/);
  });
});
