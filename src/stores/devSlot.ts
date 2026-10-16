import type { ComponentType } from "react";
import { create } from "zustand";

/**
 * Where the dev toolkit (src/dev, loaded only by `npm run tauri dev`) puts its top-bar chip. In release builds
 * src/dev isn't bundled at all, so nothing can ever fill this.
 */
export const useDevSlot = create<{ chip: ComponentType | null }>(() => ({ chip: null }));
