import { ArrowLeft, ArrowRight } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { UiStyleScope } from "../components/UiStyle";
import { Spring, useSwap } from "../motion";
import { useAuth } from "../stores/auth";
import { openSettings, useNav } from "../stores/nav";
import { finishOnboarding, useOnboarding } from "./store";
import { ColorsStep, Done, NowPlayingStep, SignIn, StyleStep, Welcome } from "./steps";

const STEPS = [
  { id: "welcome", label: "Welcome" },
  { id: "signin", label: "Sign in" },
  { id: "style", label: "Style" },
  { id: "colors", label: "Colors" },
  { id: "nowplaying", label: "Now Playing" },
  { id: "done", label: "Done" },
] as const;

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * First-run welcome: a full-window layer (M3 style) over the app, six short steps. Every choice is applied and
 * saved as it's made; "Skip setup" (every step) and "Start listening" end it for good. Keyboard: Tab stays inside,
 * Enter goes on (unless a control has the focus), Esc asks whether to skip. Steps swap on a spring and the layer
 * fades in and out on one, all instant with animations off. Loaded lazily: only a fresh install ever pays for it.
 */
export default function Onboarding() {
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [askSkip, setAskSkip] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const fade = useRef<Spring | null>(null);
  const swap = useSwap(STEPS[step].id, dir);
  const last = step === STEPS.length - 1;
  // Run again from Settings → About: Done goes back there.
  const rerun = useOnboarding((s) => s.rerun);
  const signedIn = useAuth((s) => s.status === "signedIn");

  // Fade in (opacity per frame from the shared loop).
  useLayoutEffect(() => {
    const el = root.current!;
    el.style.opacity = "0";
    fade.current = new Spring(0, "slowEffects", (v) => (el.style.opacity = String(Math.min(1, Math.max(0, v)))), { precision: 0.002 });
    fade.current.to(1, () => (el.style.opacity = ""));
    return () => fade.current?.stop();
  }, []);

  // A new step: its heading takes the focus, so keyboard and screen reader users start at the top of it.
  useEffect(() => {
    root.current?.querySelector<HTMLElement>("[data-step-title]")?.focus({ preventScroll: true });
  }, [step]);

  const close = (then?: () => void) => {
    const done = () => {
      finishOnboarding();
      then?.();
    };
    if (!fade.current) return done();
    fade.current.to(0, done);
  };
  const go = (to: number) => {
    setDir(to > step ? 1 : -1);
    setStep(Math.max(0, Math.min(STEPS.length - 1, to)));
  };
  const next = () => (last ? close(() => (rerun ? openSettings("about") : useNav.getState().go({ name: "home" }))) : go(step + 1));
  const skip = () => close();
  const signIn = () => {
    setSigningIn(true);
    void useAuth.getState().login().finally(() => setSigningIn(false));
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Tab") {
      // Focus stays inside the welcome.
      const list = [...root.current!.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!list.length) return;
      const first = list[0], end = list[list.length - 1];
      if (e.shiftKey && (document.activeElement === first || !root.current!.contains(document.activeElement))) {
        e.preventDefault();
        end.focus();
      } else if (!e.shiftKey && document.activeElement === end) {
        e.preventDefault();
        first.focus();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setAskSkip((a) => !a);
    } else if (e.key === "Enter" && !askSkip) {
      // Enter on a control does what the control does; anywhere else it's Next.
      const t = e.target as HTMLElement;
      if (t.closest("button, a, input, select, textarea, [role=slider], [role=switch], [role=radio]")) return;
      e.preventDefault();
      next();
    }
  };

  return (
    <div ref={root} role="dialog" aria-modal="true" aria-label="Welcome to ytdesk" onKeyDown={onKeyDown} className="fixed inset-0 z-[80]">
      <UiStyleScope value="m3" className="flex h-full flex-col bg-[var(--m3-surface)] text-[var(--m3-on-surface)]">
        <header className="flex shrink-0 items-center gap-4 px-6 pt-5">
          <ol className="flex flex-1 items-center gap-1.5" aria-label="Setup steps">
            {STEPS.map((s, i) => (
              <li key={s.id} aria-current={i === step ? "step" : undefined} title={s.label}
                className={`h-1.5 rounded-full ${i === step ? "w-8 bg-[var(--m3-primary)]" : i < step ? "w-4 bg-[var(--m3-primary)] opacity-60" : "w-4 bg-[var(--m3-surface-container-highest)]"}`}>
                <span className="sr-only">{`Step ${i + 1} of ${STEPS.length}: ${s.label}`}</span>
              </li>
            ))}
          </ol>
          {!last && <button className="m3-btn m3-text h-10" onClick={() => setAskSkip(true)}>Skip setup</button>}
        </header>

        {/* Short steps sit in the middle of the window; long ones scroll. */}
        <main className="scroll-y flex min-h-0 flex-1 flex-col">
          <div ref={swap} className="mx-auto my-auto w-full max-w-3xl px-6 py-8 max-sm:px-4">
            {STEPS[step].id === "welcome" && <Welcome />}
            {STEPS[step].id === "signin" && <SignIn busy={signingIn} onSignIn={signIn} onContinue={() => go(step + 1)} />}
            {STEPS[step].id === "style" && <StyleStep />}
            {STEPS[step].id === "colors" && <ColorsStep onMore={() => close(() => openSettings("appearance"))} />}
            {STEPS[step].id === "nowplaying" && <NowPlayingStep />}
            {STEPS[step].id === "done" && <Done />}
          </div>
        </main>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--m3-outline-variant)] px-6 py-4 max-sm:px-4">
          {step > 0 ? (
            <button className="m3-btn m3-outlined h-12" onClick={() => go(step - 1)}><ArrowLeft size={18} aria-hidden /> Back</button>
          ) : <span />}
          <button className="m3-btn m3-filled h-12 px-6" onClick={next}>
            {step === 0 ? "Get started" : last ? (rerun ? "Back to Settings" : "Start listening") : STEPS[step].id === "signin" && signedIn ? "Continue" : "Next"}
            {!last && <ArrowRight size={18} aria-hidden />}
          </button>
        </footer>

        {askSkip && (
          <div className="absolute inset-0 flex items-center justify-center bg-[color-mix(in_srgb,var(--m3-scrim)_40%,transparent)] p-4" onClick={() => setAskSkip(false)}>
            <div role="alertdialog" aria-labelledby="skip-title" aria-describedby="skip-text" onClick={(e) => e.stopPropagation()}
              className="m3-dialog w-full max-w-sm rounded-[var(--m3-corner-xl)] bg-[var(--m3-surface-container-high)] p-6">
              <h2 id="skip-title" className="type-headline-small">Skip setup?</h2>
              <p id="skip-text" className="type-body-medium mt-3 text-[var(--m3-on-surface-variant)]">
                {rerun ? "Your settings stay as they are now." : "What you've picked so far stays, the rest keeps its defaults."} You can change it all in Settings.
              </p>
              <div className="mt-6 flex justify-end gap-2">
                <button autoFocus className="m3-btn m3-text h-10" onClick={() => setAskSkip(false)}>Keep going</button>
                <button className="m3-btn m3-filled h-10" onClick={skip}>Skip setup</button>
              </div>
            </div>
          </div>
        )}
      </UiStyleScope>
    </div>
  );
}
