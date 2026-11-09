// Full screen (F11 by default, the command palette): the window covers the whole screen, without the desktop's bars.
import { getCurrentWindow } from "@tauri-apps/api/window";

export async function toggleFullscreen() {
  const win = getCurrentWindow();
  try {
    await win.setFullscreen(!(await win.isFullscreen()));
  } catch {
    /* the compositor said no: nothing to undo */
  }
}
