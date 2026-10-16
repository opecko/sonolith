import { Spring, type SpringParams } from "../../motion";
import type { Tab as PanelTab } from "./shared";

export type { PanelTab };
export interface PanelView {
  /** The panel is in the layout (open, or still sliding in or out). */
  mounted: boolean;
  /** The content it shows; kept while it closes, so the content doesn't change on the way out. */
  tab: PanelTab;
}

/** Critically damped: the content beside the panel must not swing past where it ends up. */
export const PUSH: SpringParams = { damping: 1, stiffness: 380 };

/**
 * State of Material's side panel slide, apart from React. One source of truth: the target (closed, or a tab).
 * The panel's width in the layout springs toward it, 0 ↔ `width`; written as whole pixels on every frame, the
 * content beside it lays out as it will when the panel is fully open, so the last frame of the slide is the
 * committed layout by construction (there is no separate "docked" commit).
 *
 * - Any number of target changes, however fast: the spring retargets from its current position and velocity
 *   (never from an edge, never a jump); the engine runs it on the one shared frame loop.
 * - Switching tabs while open only swaps the content: the spring keeps going where it was going.
 * - The unmount after closing runs only if the target is still "closed" when the spring gets to 0; a newer
 *   target replaces that callback (Spring.to) and the check guards it as well.
 */
export class PushPanel {
  private target: PanelTab | null = null;
  private view: PanelView;
  private spring: Spring;

  constructor(
    private width: number,
    private readonly paint: (px: number) => void,
    private readonly change: (view: PanelView) => void,
    initial: PanelTab | null = null,
  ) {
    this.target = initial;
    this.view = { mounted: initial !== null, tab: initial ?? "upnext" };
    this.spring = new Spring(initial ? width : 0, PUSH, (v) => this.paint(Math.round(v)), { precision: 0.1 });
  }

  /** The current width in whole pixels (to apply when the panel element mounts). */
  get px() {
    return Math.round(this.spring.value);
  }

  get state(): PanelView {
    return this.view;
  }

  setTarget(next: PanelTab | null) {
    if (next === this.target) return;
    this.target = next;
    if (next) {
      if (!this.view.mounted || this.view.tab !== next) this.emit({ mounted: true, tab: next });
      if (this.spring.target !== this.width) this.spring.to(this.width);
      return;
    }
    this.spring.to(0, () => {
      if (this.target === null) this.emit({ ...this.view, mounted: false });
    });
  }

  /** Window resized: open, the panel follows the new width (no animation when it isn't moving). */
  setWidth(width: number) {
    if (width === this.width) return;
    this.width = width;
    if (!this.target) return;
    if (this.spring.animating) this.spring.to(width);
    else this.spring.set(width);
  }

  dispose() {
    this.spring.stop();
  }

  private emit(view: PanelView) {
    this.view = view;
    this.change(view);
  }
}
