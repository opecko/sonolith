import { AlertCircle, Info } from "lucide-react";
import { useToast } from "../stores/toast";

export default function Toast() {
  const message = useToast((s) => s.message);
  const kind = useToast((s) => s.kind);
  if (!message) return null;
  return (
    <div role={kind === "error" ? "alert" : "status"} className="fixed bottom-24 left-1/2 z-50 flex max-w-lg -translate-x-1/2 items-start gap-3 rounded-lg border border-[var(--c-outline)] bg-[var(--c-surface-3)] px-4 py-3 text-sm shadow-2xl">
      {kind === "error" ? <AlertCircle size={20} className="shrink-0 text-[var(--c-error)]" aria-hidden /> : <Info size={20} className="shrink-0 text-[var(--c-text-muted)]" aria-hidden />}
      <span className="select-text">{message}</span>
    </div>
  );
}
