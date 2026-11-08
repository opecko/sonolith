import { describe, expect, it } from "vitest";
import { underInset } from "./underClip";

const panel = { top: 0, height: 1000 };
const content = { top: 0, bottom: 928 };

describe("the app under a sliding Now Playing", () => {
  it("is cut where the overlay's top edge is", () => {
    expect(underInset(100, panel, content)).toBe(0);
    expect(underInset(50, panel, content)).toBe(428);
    expect(underInset(0, panel, content)).toBe(928);
  });

  it("never cuts more than the whole content, nor less than nothing", () => {
    expect(underInset(-5, panel, content)).toBe(928);
    expect(underInset(120, panel, content)).toBe(0);
    expect(underInset(30, { top: 0, height: 1000 }, { top: 400, bottom: 928 })).toBe(528);
  });
});
