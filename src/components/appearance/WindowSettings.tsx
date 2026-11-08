import { AlertTriangle, RotateCw } from "lucide-react";
import { useState } from "react";
import { setAppearance, useSettings } from "../../stores/settings";
import { restartApp, setTransparentWindow, useWindowGlass } from "../../stores/windowGlass";
import { blurHint, detectDesktop } from "../../theme/blurHelp";
import { OPACITY_MAX, OPACITY_MIN } from "../../theme/glass";
import { SettingCard, SettingRow } from "../../views/settings/kit";
import Slider from "../Slider";
import Switch from "../Switch";

const pct = (v: number) => `${Math.round(v * 100)} %`;

/** Settings → Look → Window (Linux only): transparent window, surface opacity and how to get blur. */
export default function WindowSettings() {
  const info = useWindowGlass((s) => s.info);
  const opacity = useSettings((s) => s.appearance.windowOpacity);
  const [busy, setBusy] = useState(false);
  if (!info?.supported) return null;
  const change = async (on: boolean) => {
    setBusy(true);
    try {
      await setTransparentWindow(on);
    } finally {
      setBusy(false);
    }
  };
  const pending = info.transparentNext !== info.transparent;
  // Asked for but not given: the screen doesn't composite (window.rs keeps the window opaque then).
  const noCompositor = info.composited === false;
  const hint = blurHint(detectDesktop(info));
  return (
    <SettingCard title="Window">
      <SettingRow id="transparent" title="Transparent window"
        detail="Lets the desktop show through the window's background. Takes effect after a restart.">
        <Switch on={info.transparentNext} onChange={(v) => void change(v)} label="Transparent window" disabled={busy} />
      </SettingRow>
      {noCompositor && (
        <div role="alert" className="m3-error-box mx-5 mb-4 flex gap-3 rounded-lg p-3 text-sm">
          <AlertTriangle size={18} className="shrink-0" aria-hidden />
          <p>No compositor is running, so the window stays opaque (it would turn black). Start one, or use a Wayland session.</p>
        </div>
      )}
      {pending && !noCompositor && (
        <SettingRow title="Restart to apply" detail={info.transparentNext ? "The window becomes transparent when Sonolith starts again." : "The window becomes opaque when Sonolith starts again."}>
          <button className="m3-btn m3-filled h-10" onClick={() => void restartApp()}><RotateCw size={18} aria-hidden /> Restart Sonolith</button>
        </SettingRow>
      )}
      {(info.transparent || info.transparentNext) && (
        <SettingRow id="opacity" title="Surface opacity" detail="How solid the backgrounds, bars and cards are. Menus and dialogs stay at least 92 %. Contrast warnings assume an opaque background.">
          <Slider className="w-40" value={opacity - OPACITY_MIN} max={OPACITY_MAX - OPACITY_MIN} step={0.05} live
            onCommit={(v) => setAppearance({ windowOpacity: Math.round((OPACITY_MIN + v) * 100) / 100 })}
            label="Surface opacity" tooltip="value" format={(v) => pct(OPACITY_MIN + v)} />
        </SettingRow>
      )}
      <details className="settings-row px-5 py-4 text-sm">
        <summary className="cursor-pointer select-none font-medium">Blur help</summary>
        <div className="mt-2 flex flex-col gap-2 text-[var(--c-text-muted)] select-text">
          <p>Sonolith can't turn blur on itself: your compositor draws it behind translucent windows. For {hint.title}:</p>
          <ul className="list-disc pl-5">{hint.steps.map((s) => <li key={s}>{s}</li>)}</ul>
          {hint.snippet && <pre className="overflow-x-auto rounded-[var(--m3-corner-sm)] bg-[var(--m3-surface-container-high)] p-3 font-mono text-xs text-[var(--c-text)]">{hint.snippet}</pre>}
        </div>
      </details>
    </SettingCard>
  );
}
