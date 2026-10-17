import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { getCookie } from "../api/client";
import { flush, storedSettings, useSettings, type Settings } from "../stores/settings";
import { initWhatsNew } from "../whatsNew/store";
import { decideLocal, decideWithNative, PRIOR_KEYS } from "./detect";

interface OnboardingState {
  open: boolean;
  /** Opened from the dev toolkit: finishing or skipping changes no flags and puts the look back as it was. */
  preview: Pick<Settings, "appearance" | "karaokeStyle"> | null;
  /** Opened again from Settings → About: starts from the current settings, closing changes nothing. */
  rerun: boolean;
}

export const useOnboarding = create<OnboardingState>(() => ({ open: false, preview: null, rerun: false }));

function presentKeys(): string[] {
  try {
    return PRIOR_KEYS.filter((k) => localStorage.getItem(k) !== null);
  } catch {
    return [];
  }
}

async function nativeEvidence() {
  const [cookie, nativeFiles] = await Promise.all([
    getCookie().then((c) => !!c, () => false),
    invoke<boolean>("app_has_prior_data").catch(() => false),
  ]);
  return { cookie, nativeFiles };
}

/**
 * Dev toolkit's "Simulate fresh install" (dev builds only; release builds drop this branch): once, the detection
 * sees no prior data at all, while the stored settings themselves stay.
 */
function simulatingFresh(): boolean {
  if (!import.meta.env.DEV) return false;
  try {
    if (!localStorage.getItem("dev:simulateFresh")) return false;
    localStorage.removeItem("dev:simulateFresh");
    return true;
  } catch {
    return false;
  }
}

/**
 * Startup: decides whether this is a fresh install (welcome shows) or not, then lets What's new run: a fresh
 * install only saves the version (no What's new over the welcome); an existing one is marked as onboarded silently
 * and gets What's new as before.
 */
let started = false;
export async function initOnboarding() {
  if (started) return;
  started = true;
  const fresh = simulatingFresh();
  let decision = decideLocal(fresh ? { settings: null, keys: [] } : { settings: storedSettings, keys: presentKeys() });
  if (decision === "ask") decision = fresh ? "show" : decideWithNative(await nativeEvidence());
  const { set } = useSettings.getState();
  if (decision === "existing") {
    set({ onboardingCompleted: true });
    flush();
  } else if (decision === "show") {
    // Stored right away: closed mid-way, it shows again next time (with the choices made so far kept).
    set({ onboardingCompleted: false });
    flush();
    useOnboarding.setState({ open: true });
  }
  initWhatsNew(decision === "show");
}

/**
 * Done or skipped: never again. A preview from the dev toolkit only closes and restores the look and karaoke style; a re-run from
 * Settings only closes (its choices were saved as they were made, and onboardingCompleted is already true).
 */
export function finishOnboarding() {
  const { preview, rerun } = useOnboarding.getState();
  if (preview) useSettings.getState().set(preview);
  else if (!rerun) {
    useSettings.getState().set({ onboardingCompleted: true });
    flush();
  }
  useOnboarding.setState({ open: false, preview: null, rerun: false });
}

/**
 * Settings → About → Run setup again: the same welcome, every step showing the current settings (the steps read
 * them, nothing is reset). No first-run path: the flags and What's new are untouched.
 */
export function rerunOnboarding() {
  useOnboarding.setState({ open: true, preview: null, rerun: true });
}

/** Dev toolkit: the welcome at any time, without touching the real flags; the look is restored when it closes. */
export function previewOnboarding() {
  const { appearance, karaokeStyle } = useSettings.getState();
  useOnboarding.setState({ open: true, preview: { appearance, karaokeStyle }, rerun: false });
}
