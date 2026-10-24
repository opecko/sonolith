import { AppWindow, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import Switch from "../components/Switch";
import { useSettings } from "../stores/settings";
import { SettingCard, SettingRow } from "../views/settings/kit";
import {
  ACTION_LABELS, bindingFromEvent, DEFAULT_BINDINGS, usesSuper, findConflict, formatBinding, rebind, sameBinding, SHORTCUT_ACTIONS,
  type Bindings, type KeyBinding, type ShortcutAction,
} from "./keys";
import { useShortcutUi } from "./store";

const setShortcuts = (patch: Partial<{ enabled: boolean; bindings: Bindings }>) =>
  useSettings.getState().set({ shortcuts: { ...useSettings.getState().shortcuts, ...patch } });

interface Pending {
  action: ShortcutAction;
  binding: KeyBinding;
  other: ShortcutAction;
}

/**
 * Settings → Keyboard shortcuts: the master switch and each action's key. Clicking a key records the next press
 * (Esc cancels; the shortcuts themselves are off meanwhile); a key another action has asks whether to swap.
 */
export default function ShortcutSettings() {
  const { enabled, bindings } = useSettings((s) => s.shortcuts);
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [superTried, setSuperTried] = useState(false);

  useEffect(() => {
    useShortcutUi.setState({ recording: recording !== null });
    setSuperTried(false);
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      // Captured before anything else: the press is the new key, not a command.
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape" && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) return setRecording(null);
      // The desktop owns Super: say so and keep listening for another key.
      if (usesSuper(e)) return setSuperTried(true);
      const binding = bindingFromEvent({ key: e.key, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altGraph: e.getModifierState?.("AltGraph") });
      if (!binding) return; // a modifier on its own: wait for the key
      const { bindings: current } = useSettings.getState().shortcuts;
      const other = findConflict(current, recording, binding);
      if (other) setPending({ action: recording, binding, other });
      else setShortcuts({ bindings: rebind(current, recording, binding, false) });
      setRecording(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording]);
  useEffect(() => () => useShortcutUi.setState({ recording: false }), []);

  const resolve = (swap: boolean) => {
    if (pending && swap) setShortcuts({ bindings: rebind(useSettings.getState().shortcuts.bindings, pending.action, pending.binding, true) });
    setPending(null);
  };
  const allDefault = SHORTCUT_ACTIONS.every((a) => sameBinding(bindings[a], DEFAULT_BINDINGS[a]));

  return (
    <>
      <SettingCard title="Keyboard shortcuts">
        <SettingRow id="shortcutsEnabled" title="Use keyboard shortcuts" detail="Keys for the player while Sonolith's window is focused.">
          <Switch on={enabled} onChange={(on) => setShortcuts({ enabled: on })} label="Use keyboard shortcuts" />
        </SettingRow>
        <p className="mx-5 mb-4 flex items-start gap-3 text-sm text-[var(--c-text-muted)]">
          <AppWindow size={18} className="mt-0.5 shrink-0 text-[var(--c-accent)]" aria-hidden />
          <span><strong className="font-semibold text-[var(--c-text)]">Only inside Sonolith:</strong> not system-wide. Your keyboard's media keys control playback everywhere.</span>
        </p>
      </SettingCard>
      <SettingCard title="Keys">
      <ul className={`flex flex-col px-5 py-2 ${enabled ? "" : "pointer-events-none opacity-50"}`} aria-disabled={!enabled}>
        {SHORTCUT_ACTIONS.map((a) => {
          const isDefault = sameBinding(bindings[a], DEFAULT_BINDINGS[a]);
          return (
            <li key={a} className="flex flex-col gap-2 border-b border-[var(--c-outline)] py-2 last:border-0">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm">{ACTION_LABELS[a]}</span>
                <div className="flex items-center gap-1">
                  <button
                    className={`chip min-w-24 justify-center font-mono ${recording === a ? "!border-[var(--c-accent)]" : ""}`}
                    aria-label={`${ACTION_LABELS[a]}: ${formatBinding(bindings[a])}. Change`}
                    aria-live="polite"
                    disabled={!enabled}
                    onClick={() => {
                      setPending(null);
                      setRecording((r) => (r === a ? null : a));
                    }}
                  >
                    {recording === a ? <span className="font-sans">Press a key…</span> : formatBinding(bindings[a])}
                  </button>
                  <button className="icon-btn h-8 w-8" disabled={!enabled || isDefault} aria-label={`Reset ${ACTION_LABELS[a]} to ${formatBinding(DEFAULT_BINDINGS[a])}`}
                    title={`Reset to ${formatBinding(DEFAULT_BINDINGS[a])}`} onClick={() => setShortcuts({ bindings: rebind(bindings, a, DEFAULT_BINDINGS[a], true) })}>
                    <RotateCcw size={16} />
                  </button>
                </div>
              </div>
              {recording === a && (
                <p className={`text-xs ${superTried ? "text-[var(--c-error)]" : "text-[var(--c-text-muted)]"}`} role={superTried ? "alert" : undefined}>
                  {superTried ? "The Super key can't be used for shortcuts. Press another key, or Esc to cancel." : "Press the new key or combination. Esc cancels."}
                </p>
              )}
              {pending?.action === a && (
                <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius)] bg-[var(--c-surface-2)] px-3 py-2 text-sm">
                  <span><strong className="font-mono">{formatBinding(pending.binding)}</strong> is already {ACTION_LABELS[pending.other].toLowerCase()}.</span>
                  <span className="flex gap-2">
                    <button className="chip" onClick={() => resolve(true)}>Swap keys</button>
                    <button className="chip" onClick={() => resolve(false)}>Cancel</button>
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      </SettingCard>
      <SettingCard>
        <SettingRow id="shortcutsReset" title="Reset all keys" detail="Every shortcut back to its default key." disabled={!enabled}>
          <button className="m3-btn m3-outlined flex h-9 items-center gap-2 rounded-full border border-[var(--c-outline)] px-4 text-sm hover:bg-[var(--c-hover)] disabled:opacity-50"
            disabled={allDefault} onClick={() => setShortcuts({ bindings: DEFAULT_BINDINGS })}>
            <RotateCcw size={16} aria-hidden /> Reset
          </button>
        </SettingRow>
      </SettingCard>
    </>
  );
}
