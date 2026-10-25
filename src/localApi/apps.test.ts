import { describe, expect, it } from "vitest";
import { activityLines, ago, allowedSummary, clock, connectionText, holdText, scopeRows } from "./apps";

describe("ago", () => {
  const now = Date.UTC(2026, 9, 24, 12);
  it("reads like a person", () => {
    expect(ago(null, now)).toBe("never");
    expect(ago(now - 10_000, now)).toBe("just now");
    expect(ago(now - 5 * 60_000, now)).toBe("5 min ago");
    expect(ago(now - 3 * 3600_000, now)).toBe("3 h ago");
    expect(ago(now - 30 * 3600_000, now)).toBe("yesterday");
    expect(ago(now - 10 * 86400_000, now)).toMatch(/2026/);
  });
});

it("lists scopes in spec order", () => {
  expect(scopeRows(["lyrics:read", "player:read"]).map((s) => s.scope)).toEqual(["player:read", "lyrics:read"]);
});

it("folds repeated calls", () => {
  const a = [{ method: "player.getState", at: 3 }, { method: "player.getState", at: 2 }, { method: "queue.get", at: 1 }];
  expect(activityLines(a)).toEqual([{ method: "player.getState", at: 3, count: 2 }, { method: "queue.get", at: 1, count: 1 }]);
});

it("says who is connected", () => {
  expect([0, 1, 3].map(connectionText)).toEqual(["Not running", "Connected now", "Connected now (3 connections)"]);
});

it("sums up what an app may do in words, with the spec's permission names", () => {
  expect(allowedSummary(["player:control", "player:read"])).toBe("Allowed to: see what's playing, control playback");
  expect(allowedSummary(["search"])).toBe("Allowed to: search YouTube Music");
  expect(allowedSummary([])).toBe("Not allowed to do anything");
});

it("shows waits as a clock, rounded up", () => {
  expect([42_000, 41_001, 600_000, 3_600_000, 0, -5].map(clock)).toEqual(["0:42", "0:42", "10:00", "1:00:00", "0:00", "0:00"]);
});

it("says when a denied app can ask again", () => {
  expect(holdText({ expired: false, until: 1_042_000 }, 1_000_000)).toBe("Denied · can ask again in 0:42");
  expect(holdText({ expired: true, until: 1_060_000 }, 1_000_000)).toBe("Not answered · can ask again in 1:00");
});
