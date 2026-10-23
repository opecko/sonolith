// The pieces every Settings page is built from, so all of them read the same way: a card per topic, a row per
// setting (name, one line on what it does, the control on the right).
import type { ReactNode } from "react";

/** A titled group of rows on one card. */
export function SettingCard({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="mb-4">
      {title && <h3 className="mb-2 px-1 text-sm font-medium text-[var(--c-text-muted)]">{title}</h3>}
      <div className="m3-section settings-card rounded-lg bg-[var(--c-surface)]">{children}</div>
    </section>
  );
}

/**
 * One setting. `id` lets What's new (and other links) bring it into view (`openSettings(section, id)`); `stacked`
 * puts a wide control (a slider list, a picker) under the text instead of beside it.
 */
export function SettingRow({ id, title, detail, children, stacked = false, disabled = false }: {
  id?: string;
  title: string;
  detail?: ReactNode;
  children?: ReactNode;
  stacked?: boolean;
  disabled?: boolean;
}) {
  return (
    <div data-setting={id} aria-disabled={disabled || undefined}
      className={`settings-row px-5 py-4 ${stacked ? "" : "flex flex-wrap items-center justify-between gap-x-6 gap-y-3"} ${disabled ? "pointer-events-none opacity-50" : ""}`}>
      <div className="min-w-0 flex-1 basis-60">
        <p className="text-sm font-medium">{title}</p>
        {detail && <p className="mt-0.5 text-sm text-[var(--c-text-muted)]">{detail}</p>}
      </div>
      {children && <div className={stacked ? "mt-3" : "flex shrink-0 items-center gap-3"}>{children}</div>}
    </div>
  );
}

/** A few mutually exclusive choices as one segmented control. */
export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="m3-segmented flex flex-wrap rounded-full bg-fg/5 p-0.5" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}
          className={`m3-seg rounded-full px-3 py-1 text-sm ${value === v ? "bg-fg/15 font-medium" : "text-[var(--c-text-muted)] hover:text-[var(--c-text)]"}`}>
          {text}
        </button>
      ))}
    </div>
  );
}
