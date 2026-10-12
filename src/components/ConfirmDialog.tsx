import { AlertTriangle } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { create } from "zustand";

interface Request {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  /** Destructive action: the confirm button is drawn in the error color. */
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

const useConfirmStore = create<{ request: Request | null }>(() => ({ request: null }));

/** Asks before doing something; resolves true only when the user presses the confirm button. */
export function confirmAction(opts: Omit<Request, "resolve">): Promise<boolean> {
  useConfirmStore.getState().request?.resolve(false);
  return new Promise((resolve) => useConfirmStore.setState({ request: { ...opts, resolve } }));
}

/** Mounted once in App. Cancel has the focus, so Enter or Esc never confirms by accident. */
export default function ConfirmDialog() {
  const request = useConfirmStore((s) => s.request);
  const cancel = useRef<HTMLButtonElement>(null);
  const answer = (ok: boolean) => {
    request?.resolve(ok);
    useConfirmStore.setState({ request: null });
  };
  useEffect(() => {
    if (!request) return;
    cancel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && answer(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });
  if (!request) return null;
  const btn = "h-10 rounded-full px-5 text-sm font-medium";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--c-overlay)] p-6" onMouseDown={(e) => e.target === e.currentTarget && answer(false)}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message"
        className="flex w-[min(460px,100%)] flex-col gap-3 rounded-lg border border-[var(--c-outline)] bg-[var(--c-surface-3)] p-6 shadow-2xl">
        <h2 id="confirm-title" className="flex items-center gap-2 text-lg font-semibold">
          {request.danger && <AlertTriangle size={20} className="shrink-0 text-[var(--c-error)]" aria-hidden />}
          {request.title}
        </h2>
        <div id="confirm-message" className="select-text text-sm text-[var(--c-text-muted)]">{request.message}</div>
        <div className="mt-2 flex justify-end gap-2">
          <button ref={cancel} className={`${btn} border border-[var(--c-outline)] hover:bg-[var(--c-hover)]`} onClick={() => answer(false)}>Cancel</button>
          <button
            className={`${btn} ${request.danger ? "bg-[var(--c-error)] text-[var(--c-bg)] hover:brightness-110" : "bg-button text-on-button hover:bg-button/90"}`}
            onClick={() => answer(true)}
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
