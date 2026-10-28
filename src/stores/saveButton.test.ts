import { describe, expect, it } from "vitest";
import { DEFAULT_SAVE_BUTTON, normalizeSaveButton, saveBehavior } from "./saveButton";

describe("normalizeSaveButton", () => {
  it("falls back to the picker", () => {
    expect(normalizeSaveButton(undefined)).toEqual(DEFAULT_SAVE_BUTTON);
    expect(normalizeSaveButton({ action: "nope", playlist: { id: 3 } })).toEqual(DEFAULT_SAVE_BUTTON);
    expect(normalizeSaveButton({ action: "direct", playlist: { id: "PL1", title: "Mix" } })).toEqual({ action: "direct", playlist: { id: "PL1", title: "Mix" } });
  });
});

describe("saveBehavior", () => {
  const lib = [{ id: "PL1", title: "Renamed" }];
  it("hides when off or signed out", () => {
    expect(saveBehavior({ action: "off", playlist: null }, true, lib)).toEqual({ kind: "hidden" });
    expect(saveBehavior({ action: "picker", playlist: null }, false, lib)).toEqual({ kind: "hidden" });
  });

  it("opens the picker", () => {
    expect(saveBehavior({ action: "picker", playlist: null }, true, null)).toEqual({ kind: "picker" });
  });

  it("saves straight into the chosen playlist, with its current title", () => {
    expect(saveBehavior({ action: "direct", playlist: { id: "PL1", title: "Old" } }, true, lib)).toEqual({ kind: "direct", id: "PL1", title: "Renamed" });
    expect(saveBehavior({ action: "direct", playlist: { id: "PL1", title: "Old" } }, true, null)).toEqual({ kind: "direct", id: "PL1", title: "Old" });
  });

  it("asks to choose when there's no usable playlist", () => {
    expect(saveBehavior({ action: "direct", playlist: null }, true, lib)).toEqual({ kind: "choose" });
    expect(saveBehavior({ action: "direct", playlist: { id: "gone", title: "Gone" } }, true, lib)).toEqual({ kind: "choose" });
  });
});
