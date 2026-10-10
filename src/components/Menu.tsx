import { ChevronLeft, MoreVertical } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface MenuEntry {
  label: string;
  icon?: ReactNode;
  onSelect?: () => void;
  /** Opens a nested list in place (e.g. "Add to playlist"). */
  submenu?: () => MenuEntry[];
  disabled?: boolean;
}

const W = 240;

/** Where a right-click asked the next ⋮ menu to open (consumed by that menu's first layout). */
let pointerAnchor: { x: number; y: number } | null = null;

/**
 * Right-click support: the innermost ancestor of `target` that holds exactly one ⋮ menu button opens that menu at
 * (x, y). Containers with several menus (lists, grids) only match through a row inside them.
 */
export function openMenuAt(target: EventTarget | null, x: number, y: number) {
  for (let el = target instanceof Element ? target : null; el && el !== document.body; el = el.parentElement) {
    if (el.closest('[role="menu"]')) return;
    // Page-level containers never count, or a page with a single row would open it from anywhere.
    if (el.matches("main, nav, header, footer, [role=dialog], [role=tabpanel]")) return;
    const buttons = el.querySelectorAll<HTMLButtonElement>("button[data-more-menu]");
    if (buttons.length > 1) return;
    if (buttons.length === 1) {
      if (buttons[0].disabled || buttons[0].getAttribute("aria-expanded") === "true") return;
      pointerAnchor = { x, y };
      buttons[0].click();
      return;
    }
  }
}

/** ⋮ button with a portal popover (never clipped by scroll containers); closes on outside click, Esc, scroll. */
export default function Menu({ entries, label = "More actions", className = "", onOpen, trigger }: {
  /** Re-evaluated on every render while open, so entries that load asynchronously appear in place. */
  entries: () => MenuEntry[];
  label?: string;
  className?: string;
  onOpen?: () => void;
  /** Custom button content (e.g. a "Save" pill); `className` then styles the whole button. Default: ⋮ icon. */
  trigger?: ReactNode;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  /** Open submenus (the root list always comes from `entries()`). */
  const [stack, setStack] = useState<MenuEntry[][]>([]);
  const [pos, setPos] = useState({ left: 0, top: 0, up: false });

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const at = pointerAnchor;
    pointerAnchor = null;
    if (at) {
      const up = at.y + 320 > window.innerHeight;
      setPos({ left: Math.max(8, Math.min(at.x, window.innerWidth - W - 8)), top: at.y, up });
      return;
    }
    const r = btn.current.getBoundingClientRect();
    const up = r.bottom + 320 > window.innerHeight;
    setPos({ left: Math.max(8, Math.min(r.right - W, window.innerWidth - W - 8)), top: up ? r.top - 4 : r.bottom + 4, up });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e.type === "keydown" && (e as KeyboardEvent).key !== "Escape") return;
      if (e.type === "mousedown" && (pop.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node))) return;
      if (e.type === "scroll" && pop.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  const list = stack.at(-1) ?? (open ? entries() : []);
  return (
    <>
      <button
        ref={btn}
        className={trigger ? className : `icon-btn h-8 w-8 shrink-0 ${className}`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        data-more-menu={trigger ? undefined : ""}
        onClick={(e) => {
          e.stopPropagation();
          setStack([]);
          if (!open) onOpen?.();
          setOpen((o) => !o);
        }}
      >
        {trigger ?? <MoreVertical size={20} />}
      </button>
      {open &&
        createPortal(
          <div
            ref={pop}
            role="menu"
            className="fixed z-50 max-h-80 overflow-y-auto rounded-lg border border-[var(--c-outline)] bg-[var(--c-surface-3)] py-2 shadow-2xl"
            style={{ left: pos.left, width: W, ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }) }}
          >
            {stack.length > 0 && (
              <button role="menuitem" onClick={() => setStack((s) => s.slice(0, -1))}
                className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-[var(--c-text-muted)] hover:bg-[var(--c-hover)]">
                <ChevronLeft size={18} aria-hidden /> Back
              </button>
            )}
            {list.length === 0 && <p className="px-4 py-2 text-sm text-[var(--c-text-subtle)]">Nothing here</p>}
            {list.map((e) => (
              <button
                key={e.label}
                role="menuitem"
                disabled={e.disabled}
                onClick={(ev) => {
                  ev.stopPropagation();
                  if (e.submenu) return setStack((s) => [...s, e.submenu!()]);
                  setOpen(false);
                  e.onSelect?.();
                }}
                className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-[var(--c-hover)] disabled:opacity-40"
              >
                {e.icon && <span className="shrink-0 text-[var(--c-text-muted)]" aria-hidden>{e.icon}</span>}
                <span className="truncate">{e.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
