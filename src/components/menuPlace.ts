// Where a ⋮ / right-click menu opens (pure): below its anchor when it fits, else above when it fits there, else on
// the roomier side; as tall as the content up to the room that side has (a scrollbar shows past that).

/** Distance kept from the window's edges. */
export const MENU_MARGIN = 8;

export interface MenuPlace {
  /** Opens upward: `top` is then the anchor edge the menu's bottom sits on. */
  up: boolean;
  /** The anchor edge it hangs from (below) or sits on (above), px from the top of the window. */
  top: number;
  /** Most it may be tall. */
  maxHeight: number;
}

export function placeMenu(anchor: { top: number; bottom: number }, contentHeight: number, viewportHeight: number, gap = 4): MenuPlace {
  const below = Math.max(0, viewportHeight - anchor.bottom - gap - MENU_MARGIN);
  const above = Math.max(0, anchor.top - gap - MENU_MARGIN);
  const up = contentHeight > below && (contentHeight <= above || above > below);
  return up ? { up, top: anchor.top - gap, maxHeight: above } : { up, top: anchor.bottom + gap, maxHeight: below };
}
