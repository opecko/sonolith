import { Check, ChevronDown } from "lucide-react";
import Menu from "./Menu";

/**
 * A dropdown for a setting with a few named choices: a button showing the current one that opens the list under
 * it (the app's ⋮ menu surface), the current choice ticked.
 */
export default function Select<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  const current = options.find((o) => o.value === value) ?? options[0];
  return (
    <Menu
      label={label}
      className="m3-btn m3-outlined flex h-10 shrink-0 items-center gap-2 rounded-full border border-[var(--c-outline)] pl-4 pr-3 text-sm hover:bg-[var(--c-hover)]"
      trigger={<>{current.label}<ChevronDown size={18} aria-hidden /></>}
      entries={() => options.map((o) => ({
        label: o.label,
        icon: o.value === value ? <Check size={18} /> : <span className="inline-block w-[18px]" />,
        onSelect: () => onChange(o.value),
      }))}
    />
  );
}
