import { describe, expect, it } from "vitest";
import { entryIds, playbackStatus, queueChangeReason, type QueueShape } from "./state";

const shape = (ids: string, index: number, auto = ""): QueueShape => ({ ids: [...ids], index, autoplay: [...ids].map((id) => auto.includes(id)) });

describe("queueChangeReason", () => {
  it("names each kind of change", () => {
    expect(queueChangeReason(shape("abc", 0), shape("abc", 0))).toBeNull();
    expect(queueChangeReason(shape("abc", 0), shape("abc", 1))).toBe("advanced");
    expect(queueChangeReason(shape("abc", 0), shape("abcd", 0))).toBe("added");
    expect(queueChangeReason(shape("abc", 0), shape("adbc", 0))).toBe("added");
    expect(queueChangeReason(shape("abc", 0), shape("abcxy", 0, "xy"))).toBe("autoplay");
    expect(queueChangeReason(shape("abcxy", 0, "xy"), shape("abc", 0))).toBe("autoplay");
    expect(queueChangeReason(shape("abc", 0), shape("ac", 0))).toBe("removed");
    expect(queueChangeReason(shape("abc", 1), shape("b", 0))).toBe("cleared");
    expect(queueChangeReason(shape("abc", 0), shape("acb", 0))).toBe("moved");
    expect(queueChangeReason(shape("abc", 0), shape("xyz", 0))).toBe("replaced");
  });
});

describe("playbackStatus", () => {
  it("maps the store's status", () => {
    expect(playbackStatus("idle", true, false)).toBe("paused");
    expect(playbackStatus("idle", false, false)).toBe("stopped");
    expect(playbackStatus("playing", true, true)).toBe("buffering");
    expect(playbackStatus("loading", true, false)).toBe("buffering");
    expect(playbackStatus("error", true, false)).toBe("stopped");
  });
});

it("numbers repeated entries", () => {
  expect(entryIds(["a", "b", "a"])).toEqual(["a", "b", "a~1"]);
});
