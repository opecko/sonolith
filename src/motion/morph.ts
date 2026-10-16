import { motionOn, Spring } from "./engine";

/**
 * Shape morph for M3 buttons, delegated from the document: `.m3-btn`, `.icon-btn` and anything with `data-morph`.
 * CSS owns the shapes: an element declares its corner radius per state as custom properties (plain px, from the
 * corner scale)
 *   --r-rest   resting radius
 *   --r-sel    when selected (aria-pressed / aria-checked / aria-selected = "true", or data-selected)
 *   --r-press  while pressed (data-pressed, set here on pointerdown)
 * and picks one per state for `border-radius: var(--r, …)`, so with animations off the shape simply switches. With
 * animations on, the radius springs between states through an inline `--r` (removed once it rests); asymmetric
 * shapes (connected groups) use `--r` for their outer corners only. Classic CSS declares no --r-rest, so nothing
 * happens there.
 */
const MORPH = "[data-morph], .m3-btn, .icon-btn, .m3-seg";
const springs = new WeakMap<HTMLElement, Spring>();

const isSelected = (el: HTMLElement, attr?: string, old?: string | null) => {
  const val = (a: string) => (a === attr ? old : el.getAttribute(a));
  return ["aria-pressed", "aria-checked", "aria-selected"].some((a) => val(a) === "true") ||
    (attr === "data-selected" ? old !== null : el.hasAttribute("data-selected"));
};

/** Radius for a state in px; null when the element has no M3 shape (Classic). Full corners clamp to a pill. */
function radiusFor(el: HTMLElement, pressed: boolean, selected: boolean): number | null {
  const cs = getComputedStyle(el);
  const v = (name: string) => {
    const s = cs.getPropertyValue(name).trim();
    return s ? parseFloat(s) : NaN;
  };
  const rest = v("--r-rest");
  if (Number.isNaN(rest)) return null;
  const sel = v("--r-sel"), press = v("--r-press");
  const r = pressed && !Number.isNaN(press) ? press : selected && !Number.isNaN(sel) ? sel : rest;
  return Math.min(r, el.offsetHeight / 2, el.offsetWidth / 2);
}

function morph(el: HTMLElement, from: { pressed: boolean; selected: boolean }) {
  // Animations off: the stylesheet switches the shape by itself.
  if (!motionOn()) return;
  const to = radiusFor(el, el.hasAttribute("data-pressed"), isSelected(el));
  if (to === null) return;
  let s = springs.get(el);
  if (!s) {
    s = new Spring(to, "fastSpatial", (r) => el.style.setProperty("--r", `${r}px`), { precision: 0.05 });
    springs.set(el, s);
  }
  // At rest, start from the previous state's shape (size or corner setting may have changed since).
  if (!s.animating) s.value = radiusFor(el, from.pressed, from.selected) ?? to;
  // At rest the stylesheet takes over again (hover/selected rules stay authoritative).
  s.to(to, () => el.style.removeProperty("--r"));
}

let started = false;
/** Installs the delegated listeners once (StrictMode-safe). */
export function initMorph() {
  if (started || typeof document === "undefined") return;
  started = true;
  let pressed: HTMLElement | null = null;
  const release = () => {
    const el = pressed;
    pressed = null;
    if (!el) return;
    el.removeAttribute("data-pressed");
    morph(el, { pressed: true, selected: isSelected(el) });
  };
  document.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const el = (e.target as Element | null)?.closest?.<HTMLElement>(MORPH);
    if (!el || (el as HTMLButtonElement).disabled) return;
    pressed = el;
    el.setAttribute("data-pressed", "");
    morph(el, { pressed: false, selected: isSelected(el) });
  }, true);
  window.addEventListener("pointerup", release, true);
  window.addEventListener("pointercancel", release, true);
  window.addEventListener("blur", release);
  new MutationObserver((records) => {
    for (const r of records) {
      const el = r.target as HTMLElement;
      if (!el.matches?.(MORPH) || r.attributeName === null) continue;
      if (isSelected(el) === isSelected(el, r.attributeName, r.oldValue)) continue;
      morph(el, { pressed: el.hasAttribute("data-pressed"), selected: isSelected(el, r.attributeName, r.oldValue) });
    }
  }).observe(document.body, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ["aria-pressed", "aria-checked", "aria-selected", "data-selected"] });
}
