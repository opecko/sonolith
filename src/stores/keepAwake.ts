// Keeps the screen on while music plays (playback/keepAwake.ts decides, Rust's awake.rs asks the system).
import { invoke } from "@tauri-apps/api/core";
import { RELEASE_AFTER_MS, wantAwake } from "../playback/keepAwake";
import { usePlayer } from "./player";
import { useSettings } from "./settings";

let started = false;
export function initKeepAwake() {
  if (started) return;
  started = true;
  let on = false;
  let release: ReturnType<typeof setTimeout> | undefined;
  const update = () => {
    const p = usePlayer.getState();
    const want = wantAwake(useSettings.getState().keepAwake, p.status, p.index >= 0);
    if (want) {
      clearTimeout(release);
      release = undefined;
      if (!on) {
        on = true;
        invoke("awake_set", { on: true }).catch(() => (on = false));
      }
    } else if (on && release === undefined) {
      release = setTimeout(() => {
        release = undefined;
        on = false;
        invoke("awake_set", { on: false }).catch(() => {});
      }, RELEASE_AFTER_MS);
    }
  };
  usePlayer.subscribe((s, p) => s.status !== p.status && update());
  useSettings.subscribe((s, p) => s.keepAwake !== p.keepAwake && update());
  update();
}
