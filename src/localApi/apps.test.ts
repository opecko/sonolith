import { describe, expect, it } from "vitest";
import { activityLines, ago, connectionText, scopeRows } from "./apps";

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
  expect([0, 1, 3].map(connectionText)).toEqual(["Not connected", "Connected now", "Connected now (3 connections)"]);
});
