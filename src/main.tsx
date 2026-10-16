import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { openMenuAt } from "./components/Menu";
import "./index.css";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { coverTokens, initCoverAccent } from "./stores/coverAccent";
import { useSettings } from "./stores/settings";
import { applyLayout, applyStyle, applyTheme } from "./theme";
import { initMorph, setMotionEnabled } from "./motion";

// Appearance goes on synchronously before the first render, so startup never flashes the default colors.
const applyColors = () => applyTheme(useSettings.getState().appearance, coverTokens());
const applyZoom = (z: number) => void getCurrentWebview().setZoom(z).catch(() => {});
applyColors();
applyLayout(useSettings.getState().appearance);
applyStyle(useSettings.getState().appearance);
setMotionEnabled(useSettings.getState().appearance.animations);
if (useSettings.getState().appearance.zoom !== 1) applyZoom(useSettings.getState().appearance.zoom);
useSettings.subscribe((s, prev) => {
  if (s.appearance === prev.appearance) return;
  const a = s.appearance, p = prev.appearance;
  // Only what the change affects: a radius or intensity drag shouldn't recompute every color token.
  if (a.palette !== p.palette || a.mode !== p.mode || a.overrides !== p.overrides || a.coverAccent !== p.coverAccent) applyColors();
  if (a.radius !== p.radius || a.density !== p.density || a.font !== p.font || a.fontFamily !== p.fontFamily) applyLayout(a);
  if (s.appearance.zoom !== prev.appearance.zoom) applyZoom(s.appearance.zoom);
  if (a.uiStyle !== p.uiStyle || a.animations !== p.animations) {
    applyStyle(a);
    setMotionEnabled(a.animations);
  }
});
initCoverAccent(applyColors);
initMorph();

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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
