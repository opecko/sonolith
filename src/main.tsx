import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { openMenuAt } from "./components/Menu";
import "./index.css";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { coverTokens, initCoverColors, paintCoverScope } from "./stores/coverColors";
import { useSettings } from "./stores/settings";
import { initWindowGlass } from "./stores/windowGlass";
import { applyAnimations, applyLayout, applyTheme, effectiveTokens } from "./theme";
import { glassOpacity, setGlassOpacity } from "./theme/glass";
import { saveSplash, splashFor } from "./theme/splash";
import { initMorph, setMotionEnabled } from "./motion";
import { initFocusMode } from "./focusMode";

// Appearance goes on synchronously before the first render, so startup never flashes the default colors. A
// transparent window is known already (index.html set data-glass), so the surfaces start translucent too.
if (document.documentElement.hasAttribute("data-glass")) setGlassOpacity(useSettings.getState().appearance.windowOpacity);
const applyColors = () => {
  applyTheme(useSettings.getState().appearance, coverTokens());
  paintCoverScope();
};
const applyZoom = (z: number) => void getCurrentWebview().setZoom(z).catch(() => {});
applyColors();
applyLayout(useSettings.getState().appearance);
applyAnimations(useSettings.getState().appearance);
setMotionEnabled(useSettings.getState().appearance.animations);
if (useSettings.getState().appearance.zoom !== 1) applyZoom(useSettings.getState().appearance.zoom);
useSettings.subscribe((s, prev) => {
  if (s.appearance === prev.appearance) return;
  const a = s.appearance, p = prev.appearance;
  // Only what the change affects: a radius or intensity drag shouldn't recompute every color token.
  if (a.palette !== p.palette || a.mode !== p.mode || a.overrides !== p.overrides || a.coverColors !== p.coverColors) applyColors();
  if (a.radius !== p.radius || a.density !== p.density || a.font !== p.font || a.fontFamily !== p.fontFamily) applyLayout(a);
  if (s.appearance.zoom !== prev.appearance.zoom) applyZoom(s.appearance.zoom);
  if (a.windowOpacity !== p.windowOpacity && glassOpacity() !== null) {
    setGlassOpacity(a.windowOpacity);
    applyColors();
  }
  if (a.animations !== p.animations) {
    applyAnimations(a);
    setMotionEnabled(a.animations);
  }
});
// Colors for the next start's startup screen: the palette's, not a cover's. Rust keeps the background too, for the
// moments before the page loads (window.rs).
const keepSplash = () => {
  const a = useSettings.getState().appearance;
  const s = splashFor(effectiveTokens(a), a.windowOpacity);
  saveSplash(s);
  invoke("window_set_splash", { bg: s.bg, opacity: s.opacity }).catch(() => {});
};
keepSplash();
useSettings.subscribe((s, prev) => {
  const a = s.appearance, p = prev.appearance;
  if (a.palette !== p.palette || a.mode !== p.mode || a.overrides !== p.overrides || a.windowOpacity !== p.windowOpacity) keepSplash();
});
initCoverColors(applyColors);
initWindowGlass(applyColors);
initMorph();
initFocusMode();

// The browser context menu (Back, Forward, Reload, Inspect Element…) never shows. Right-click on anything with a ⋮
// menu (track rows, cards, the player bar) opens that menu at the pointer instead.
window.addEventListener(
  "contextmenu",
  (e) => {
    e.preventDefault();
    openMenuAt(e.target, e.clientX, e.clientY);
  },
  true,
);
// Browser shortcuts that would reload the page, navigate it or open devtools.
window.addEventListener(
  "keydown",
  (e) => {
    const k = e.key.toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;
    if (
      k === "f5" || k === "f12" || k === "browserback" || k === "browserforward" ||
      (ctrl && (k === "r" || k === "p" || k === "u" || (e.shiftKey && ["i", "j", "c"].includes(k)))) ||
      (e.altKey && (k === "arrowleft" || k === "arrowright"))
    )
      e.preventDefault();
  },
  true,
);

// Dev toolkit (`npm run tauri dev` only): a dynamic import behind import.meta.env.DEV, which Vite turns into
// `false` for release builds, so src/dev never ships. Nothing else may import from src/dev.
if (import.meta.env.DEV) void import("./dev").then((m) => m.mountDevTools());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
