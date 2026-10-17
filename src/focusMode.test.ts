import { describe, expect, it } from "vitest";
import { navigationKey } from "./focusMode";

describe("keyboard navigation modality", () => {
  it("Tab and arrows (outside text fields) turn focus rings on", () => {
    expect(navigationKey("Tab", false)).toBe(true);
    expect(navigationKey("Tab", true)).toBe(true);
    expect(navigationKey("ArrowDown", false)).toBe(true);
    expect(navigationKey("ArrowLeft", false)).toBe(true);
  });

  it("Enter, Space, shortcuts and arrows while typing don't", () => {
    for (const k of ["Enter", " ", ">", "<", "+", "-", "a", "Escape"]) expect(navigationKey(k, false)).toBe(false);
    expect(navigationKey("ArrowLeft", true)).toBe(false);
  });
});
