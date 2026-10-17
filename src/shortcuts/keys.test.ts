import { describe, expect, it } from "vitest";
import {
  bindingFromEvent, DEFAULT_BINDINGS, findConflict, formatBinding, isTyping, matchAction, normalizeShortcuts, rebind, spaceOwnedByControl,
  type KeyEventLike,
} from "./keys";

const ev = (key: string, mods: Partial<KeyEventLike> = {}): KeyEventLike => ({ key, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...mods });
const match = (e: KeyEventLike) => matchAction(e, DEFAULT_BINDINGS);

describe("key matching", () => {
  it("defaults: Space, <, >, +, -", () => {
    expect(match(ev(" "))).toBe("playPause");
    expect(match(ev("<"))).toBe("prev");
    expect(match(ev(">"))).toBe("next");
    expect(match(ev("+"))).toBe("volumeUp");
    expect(match(ev("-"))).toBe("volumeDown");
  });

  it("matches the character, whatever the layout needs to type it", () => {
    // US: > is Shift+. ; Czech QWERTZ: + is unshifted, < > come with AltGr (Linux reports no Alt for it).
    expect(match(ev(">", { shiftKey: true }))).toBe("next");
    expect(match(ev("+"))).toBe("volumeUp");
    expect(match(ev("+", { shiftKey: true }))).toBe("volumeUp");
    expect(match(ev("<", { altGraph: true }))).toBe("prev");
    // Windows reports AltGr as Ctrl+Alt: still the plain character.
    expect(match(ev(">", { ctrlKey: true, altKey: true, altGraph: true }))).toBe("next");
  });

  it("numpad + and − report the same keys", () => {
    // NumpadAdd / NumpadSubtract: event.key is "+" / "-" (only event.code differs, which isn't used).
    expect(match(ev("+"))).toBe("volumeUp");
    expect(match(ev("-"))).toBe("volumeDown");
  });

  it("combos with Ctrl, Alt or Meta don't trigger plain bindings (app zoom, other shortcuts)", () => {
    expect(match(ev("+", { ctrlKey: true }))).toBeNull();
    expect(match(ev("-", { ctrlKey: true }))).toBeNull();
    expect(match(ev(" ", { altKey: true }))).toBeNull();
    expect(match(ev(">", { metaKey: true }))).toBeNull();
  });

  it("a combo the user bound matches only with its modifiers", () => {
    const bindings = { ...DEFAULT_BINDINGS, next: { key: "ArrowRight", ctrl: true } };
    expect(matchAction(ev("ArrowRight", { ctrlKey: true }), bindings)).toBe("next");
    expect(matchAction(ev("ArrowRight"), bindings)).toBeNull();
    expect(matchAction(ev("ArrowRight", { ctrlKey: true, shiftKey: true }), bindings)).toBeNull();
  });

  it("held keys: only volume repeats", () => {
    expect(match(ev(" ", { repeat: true }))).toBeNull();
    expect(match(ev(">", { repeat: true }))).toBeNull();
    expect(match(ev("<", { repeat: true }))).toBeNull();
    expect(match(ev("+", { repeat: true }))).toBe("volumeUp");
    expect(match(ev("-", { repeat: true }))).toBe("volumeDown");
  });

  it("letters match in either case; bare modifiers never bind", () => {
    const bindings = { ...DEFAULT_BINDINGS, playPause: { key: "k" } };
    expect(matchAction(ev("K"), bindings)).toBe("playPause");
    expect(bindingFromEvent(ev("Shift", { shiftKey: true }))).toBeNull();
    expect(bindingFromEvent(ev("Control", { ctrlKey: true }))).toBeNull();
  });

  it("formats keys for tooltips and Settings", () => {
    expect(formatBinding({ key: " " })).toBe("Space");
    expect(formatBinding({ key: ">" })).toBe(">");
    expect(formatBinding({ key: "k" })).toBe("K");
    expect(formatBinding({ key: "ArrowUp", ctrl: true, shift: true })).toBe("Ctrl+Shift+↑");
  });
});

describe("typing guard", () => {
  it("text fields, selects and contenteditable swallow shortcuts", () => {
    expect(isTyping({ tagName: "INPUT" })).toBe(true);
    expect(isTyping({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTyping({ tagName: "SELECT" })).toBe(true);
    expect(isTyping({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("buttons, rows and the page don't", () => {
    expect(isTyping({ tagName: "BUTTON" })).toBe(false);
    expect(isTyping({ tagName: "LI" })).toBe(false);
    expect(isTyping({ tagName: "BODY" })).toBe(false);
    expect(isTyping(null)).toBe(false);
  });

  it("Space on a control inside a menu or dialog is the control's", () => {
    const at = (inDialog: boolean, onControl: boolean) => ({
      closest: (sel: string) => (sel.includes("dialog") ? inDialog : onControl) || null,
    });
    expect(spaceOwnedByControl(at(true, true))).toBe(true);
    expect(spaceOwnedByControl(at(true, false))).toBe(false);
    expect(spaceOwnedByControl(at(false, true))).toBe(false);
  });
});

describe("conflicts", () => {
  it("finds the action that already has a key", () => {
    expect(findConflict(DEFAULT_BINDINGS, "next", { key: " " })).toBe("playPause");
    expect(findConflict(DEFAULT_BINDINGS, "next", { key: ">" })).toBeNull(); // its own key
    expect(findConflict(DEFAULT_BINDINGS, "next", { key: "n" })).toBeNull();
    expect(findConflict(DEFAULT_BINDINGS, "next", { key: " ", ctrl: true })).toBeNull();
  });

  it("swap gives the other action the old key; without swap only one action changes", () => {
    const swapped = rebind(DEFAULT_BINDINGS, "next", { key: " " }, true);
    expect(swapped.next).toEqual({ key: " " });
    expect(swapped.playPause).toEqual({ key: ">" });
    const plain = rebind(DEFAULT_BINDINGS, "next", { key: "n" }, false);
    expect(plain).toEqual({ ...DEFAULT_BINDINGS, next: { key: "n" } });
  });
});

describe("settings migration", () => {
  it("settings without shortcuts (before this version) get the defaults, enabled", () => {
    expect(normalizeShortcuts(undefined)).toEqual({ enabled: true, bindings: DEFAULT_BINDINGS });
  });

  it("keeps valid bindings and the switch", () => {
    const s = normalizeShortcuts({ enabled: false, bindings: { next: { key: "n" }, prev: { key: "ArrowLeft", ctrl: true } } });
    expect(s.enabled).toBe(false);
    expect(s.bindings.next).toEqual({ key: "n" });
    expect(s.bindings.prev).toEqual({ key: "ArrowLeft", ctrl: true });
    expect(s.bindings.playPause).toEqual(DEFAULT_BINDINGS.playPause);
  });

  it("unknown actions and broken bindings fall back to the defaults", () => {
    const s = normalizeShortcuts({ enabled: "yes", bindings: { next: { key: "" }, prev: "x", volumeUp: { key: "Shift" }, volumeDown: { key: "q", ctrl: "y" }, bogus: { key: "z" } } });
    expect(s.enabled).toBe(true);
    expect(s.bindings).toEqual(DEFAULT_BINDINGS);
    expect("bogus" in s.bindings).toBe(false);
  });
});
