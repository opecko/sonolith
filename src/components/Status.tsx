import { AlertCircle, RotateCw } from "lucide-react";
import { Component, type ReactNode } from "react";
import { AuthError } from "../api/client";
import { useAuth } from "../stores/auth";
import { useUiStyle } from "../stores/settings";
import { LoadingIndicator } from "./LoadingIndicator";

export function Loading({ variant = "shelves", label = "Loading" }: { variant?: "shelves" | "list" | "grid"; label?: string }) {
  const card = (k: number) => (
    <div key={k} className="w-[180px] shrink-0">
      <div className="skeleton aspect-square w-full" />
      <div className="skeleton mt-3 h-4 w-32" />
      <div className="skeleton mt-2 h-4 w-20" />
    </div>
  );
  const six = [0, 1, 2, 3, 4, 5, 6];
  const m3 = useUiStyle() === "m3";
  // M3: lists wait on the loading indicator; shelves and grids keep their skeletons (they hold the page's layout).
  if (m3 && variant === "list")
    return (
      <div role="status" aria-busy="true" aria-label={label} className="flex justify-center py-16">
        <LoadingIndicator contained label={label} />
      </div>
    );
  return (
    <div role="status" aria-busy="true" aria-label={label}>
      {variant === "shelves" &&
        [0, 1, 2].map((r) => (
          <div key={r} className="mb-12">
            <div className="skeleton mb-4 h-7 w-64" />
            <div className="flex gap-6 overflow-hidden">{six.map(card)}</div>
          </div>
        ))}
      {variant === "grid" && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-x-6 gap-y-8">
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i}><div className="skeleton aspect-square w-full" /><div className="skeleton mt-3 h-4 w-3/4" /><div className="skeleton mt-2 h-4 w-1/2" /></div>
          ))}
        </div>
      )}
      {variant === "list" &&
        Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 px-2 py-2">
            <div className="skeleton h-10 w-10" />
            <div className="flex-1"><div className="skeleton h-4 w-1/3" /><div className="skeleton mt-2 h-4 w-1/5" /></div>
          </div>
        ))}
    </div>
  );
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    const { error } = this.state;
    return error ? <ErrorBox error={error} onRetry={() => this.setState({ error: null })} /> : this.props.children;
  }
}

export function ErrorBox({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  const login = useAuth((s) => s.login);
  const isAuth = error instanceof AuthError;
  return (
    <div role="alert" className="m3-error-box my-6 flex max-w-2xl gap-4 rounded-lg border border-[var(--c-error)]/30 bg-[var(--c-error)]/10 p-4">
      <AlertCircle size={24} className="shrink-0 text-[var(--c-error)]" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{isAuth ? "Please sign in" : "Something went wrong"}</p>
        <p className="mt-1 select-text whitespace-pre-wrap break-words text-sm text-[var(--c-text-muted)]">{error.message}</p>
        <div className="mt-4 flex gap-2">
          {isAuth && <button onClick={login} className="m3-btn m3-filled h-8 rounded-full bg-button px-4 text-sm font-medium text-on-button">Sign in</button>}
          {onRetry && (
            <button onClick={onRetry} className="m3-btn m3-outlined flex h-8 items-center gap-2 rounded-full border border-[var(--c-outline)] px-4 text-sm hover:bg-[var(--c-hover)]">
              <RotateCw size={16} aria-hidden /> Retry
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="mx-auto mt-16 max-w-sm text-center">
      <p className="text-base font-medium">{title}</p>
      {detail && <p className="mt-2 text-sm text-[var(--c-text-muted)]">{detail}</p>}
    </div>
  );
}
