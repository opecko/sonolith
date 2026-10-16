import { useDevSlot } from "../stores/devSlot";
import DevChip from "./DevChip";
import { useDevFlags } from "./flags";

/**
 * Dev toolkit entry. Loaded only from main.tsx inside `if (import.meta.env.DEV)` with a dynamic import, so Vite
 * drops it (and everything it imports) from production builds. Nothing outside src/dev imports from here.
 */
export const DEV_TOOLKIT_MARKER = "ytdesk-dev-toolkit-9c41e7";

export function mountDevTools() {
  useDevSlot.setState({ chip: DevChip, skipHistory: () => useDevFlags.getState().noHistory });
}
