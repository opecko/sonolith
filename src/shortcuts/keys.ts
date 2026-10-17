/** In-window keyboard shortcuts (separate from the global media keys in stores/mediaKeys.ts). Pure: no DOM, no stores. */

export const SHORTCUT_ACTIONS = ["playPause", "prev", "next", "volumeUp", "volumeDown"] as const;
export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];

export const ACTION_LABELS: Record<ShortcutAction, string> = {
  playPause: "Play / pause",
  prev: "Previous track",
  next: "Next track",
  volumeUp: "Volume up",
  volumeDown: "Volume down",
};

/**
 * A key as `KeyboardEvent.key` reports it (" " for Space), so it means the same character on every layout: on a
 * Czech QWERTZ "+" is unshifted and "<" / ">" sit elsewhere, and the numpad's + and − report "+" and "-" too.
 * Modifiers are only the ones that change what a key does (Ctrl, Alt); Shift is part of the character (">" is
 * already Shift+.), and only counts for named keys such as "ArrowUp". The Super / Meta key is never part of a
 * binding: the desktop owns it (launcher, window management).
 */
export interface KeyBinding {
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
}

export type Bindings = Record<ShortcutAction, KeyBinding>;

export interface ShortcutSettings {
  enabled: boolean;
  bindings: Bindings;
}

export const DEFAULT_BINDINGS: Bindings = {
  playPause: { key: " " },
  prev: { key: "<" },
  next: { key: ">" },
  volumeUp: { key: "+" },
  volumeDown: { key: "-" },
};

export const DEFAULT_SHORTCUTS: ShortcutSettings = { enabled: true, bindings: DEFAULT_BINDINGS };

/** Held down, these repeat; the rest fire once per press. */
const REPEATS: ReadonlySet<ShortcutAction> = new Set(["volumeUp", "volumeDown"]);

/** What of a KeyboardEvent the matching needs. */
export interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  repeat?: boolean;
  /** getModifierState("AltGraph"): Windows reports AltGr as Ctrl+Alt, which mustn't count as a combo. */
  altGraph?: boolean;
}

/** The Super / Meta key, alone or held with another key. */
export const SUPER_KEYS: ReadonlySet<string> = new Set(["Meta", "OS", "Super", "Hyper"]);
export const usesSuper = (e: Pick<KeyEventLike, "key" | "metaKey">) => e.metaKey || SUPER_KEYS.has(e.key);

/** Keys that are only modifiers: pressing them alone never binds or triggers anything. */
export const MODIFIER_KEYS: ReadonlySet<string> = new Set(["Shift", "Control", "Alt", "AltGraph", "Meta", "OS", "Super", "Hyper", "CapsLock", "Fn", "Dead", "Unidentified", "Process"]);

const printable = (key: string) => [...key].length === 1;
/** Letters match in either case (Caps Lock), everything else exactly. */
const normKey = (key: string) => (printable(key) ? key.toLowerCase() : key);

/** The binding a key press makes (Settings' recording). Null for a bare modifier or anything with Super. */
export function bindingFromEvent(e: KeyEventLike): KeyBinding | null {
  if (MODIFIER_KEYS.has(e.key) || usesSuper(e)) return null;
  const altGr = !!e.altGraph;
  const b: KeyBinding = { key: printable(e.key) ? normKey(e.key) : e.key };
  if (e.ctrlKey && !altGr) b.ctrl = true;
  if (e.altKey && !altGr) b.alt = true;
  if (e.shiftKey && !printable(e.key)) b.shift = true;
  return b;
}

export const sameBinding = (a: KeyBinding, b: KeyBinding) =>
  normKey(a.key) === normKey(b.key) && !!a.ctrl === !!b.ctrl && !!a.alt === !!b.alt &&
  (printable(a.key) || !!a.shift === !!b.shift);

/**
 * The action a key press triggers, or null. Unbound combos (Ctrl+…, Alt+…: app zoom and the like) and anything
 * with Super never match; held-down keys only repeat the volume actions.
 */
export function matchAction(e: KeyEventLike, bindings: Bindings): ShortcutAction | null {
  const pressed = bindingFromEvent(e);
  if (!pressed) return null;
  const action = SHORTCUT_ACTIONS.find((a) => sameBinding(bindings[a], pressed)) ?? null;
  if (action && e.repeat && !REPEATS.has(action)) return null;
  return action;
}

/** The other action already on this key (Settings offers swap or cancel), or null. */
export function findConflict(bindings: Bindings, action: ShortcutAction, binding: KeyBinding): ShortcutAction | null {
  return SHORTCUT_ACTIONS.find((a) => a !== action && sameBinding(bindings[a], binding)) ?? null;
}

/** Puts `binding` on `action`; with `swap`, the action that had it gets `action`'s old key. */
export function rebind(bindings: Bindings, action: ShortcutAction, binding: KeyBinding, swap: boolean): Bindings {
  const other = findConflict(bindings, action, binding);
  const next = { ...bindings, [action]: binding };
  if (other && swap) next[other] = bindings[action];
  return next;
}

const NAMES: Record<string, string> = { " ": "Space", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Escape: "Esc" };

/** "Space", ">", "Ctrl+Shift+↑". */
export function formatBinding(b: KeyBinding): string {
  const key = NAMES[b.key] ?? (printable(b.key) ? b.key.toUpperCase() : b.key);
  return [b.ctrl && "Ctrl", b.alt && "Alt", b.shift && "Shift", key].filter(Boolean).join("+");
}

/** What a shortcut can be focused on and still not count as typing. */
export interface TargetLike {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
}

/** The key goes into a text field (search, hex fields, font search, …): shortcuts stay out of the way. */
export function isTyping(t: TargetLike | null | undefined): boolean {
  if (!t) return false;
  const tag = t.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  return !!t.isContentEditable;
}

/**
 * Space on a control inside a menu or modal dialog belongs to that control (activating a menu item, a dialog button,
 * a switch); there Space doesn't toggle playback. Elsewhere it does, even on a focused button or row.
 */
export function spaceOwnedByControl(t: TargetLike | null | undefined): boolean {
  if (!t?.closest) return false;
  // Modal dialogs and menus only: Now Playing is a (non-modal) dialog too, and Space must play / pause there.
  const inside = t.closest('[role="menu"], [role="listbox"], [role="alertdialog"], [aria-modal="true"]');
  const control = t.closest('button, a[href], [role="menuitem"], [role="option"], [role="switch"], [role="checkbox"], [role="radio"], [role="tab"], [role="slider"]');
  return !!inside && !!control;
}

const isBinding = (v: unknown): v is KeyBinding => {
  if (!v || typeof v !== "object") return false;
  const b = v as Record<string, unknown>;
  // A stored binding with Super (allowed before) is dropped: the action gets its default back.
  return typeof b.key === "string" && b.key.length > 0 && b.key.length <= 24 && !MODIFIER_KEYS.has(b.key) && !b.meta &&
    ["ctrl", "alt", "meta", "shift"].every((m) => b[m] === undefined || typeof b[m] === "boolean");
};

/** Stored value → settings. Missing, unknown or broken bindings fall back to their default. */
export function normalizeShortcuts(raw: unknown): ShortcutSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const stored = (r.bindings && typeof r.bindings === "object" ? r.bindings : {}) as Record<string, unknown>;
  const bindings = { ...DEFAULT_BINDINGS };
  for (const a of SHORTCUT_ACTIONS) {
    const b = stored[a];
    if (isBinding(b)) bindings[a] = { key: b.key, ...(b.ctrl && { ctrl: true }), ...(b.alt && { alt: true }), ...(b.shift && { shift: true }) };
  }
  return { enabled: typeof r.enabled === "boolean" ? r.enabled : true, bindings };
}
