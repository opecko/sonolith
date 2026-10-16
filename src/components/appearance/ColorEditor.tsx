import { AlertTriangle, RotateCcw } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import { M3_CONTRAST_PAIRS, m3Roles } from "../../theme/m3";
import { useUiStyle } from "../UiStyle";
import { contrast, isHex, parseHex, toHex } from "../../theme/color";
import { SIMPLE_TOKENS, TOKEN_LABELS, TOKENS, type Token, type TokenMap } from "../../theme/tokens";

/** WCAG AA for normal text. */
const MIN_CONTRAST = 4.5;
const PAIRS: { fg: Token; bg: Token; label: string }[] = [
  { fg: "text", bg: "bg", label: "Text on background" },
  { fg: "text-muted", bg: "bg", label: "Muted text on background" },
  { fg: "on-accent", bg: "accent", label: "Text on accent" },
];

export function ContrastWarnings({ tokens }: { tokens: TokenMap }) {
  const m3 = useUiStyle() === "m3";
  const roles = useMemo(() => (m3 ? m3Roles(tokens) : null), [m3, tokens]);
  const low = [
    ...PAIRS.map((p) => ({ label: p.label, ratio: contrast(tokens[p.fg], tokens[p.bg]) })),
    // The M3 style also puts text on colors derived from the tokens (containers).
    ...(roles ? M3_CONTRAST_PAIRS.map((p) => ({ label: p.label, ratio: contrast(roles[p.fg], roles[p.bg]) })) : []),
  ].filter((p) => p.ratio < MIN_CONTRAST);
  if (!low.length) return null;
  return (
    <ul className="mb-4 flex flex-col gap-1 rounded-[var(--radius)] border border-[var(--c-outline)] p-3 text-sm" role="status">
      {low.map((p) => (
        <li key={p.label} className="flex items-center gap-2 text-[var(--c-text-muted)]">
          <AlertTriangle size={16} className="shrink-0 text-[var(--c-error)]" aria-hidden />
          {p.label}: contrast {p.ratio.toFixed(1)}:1, below the recommended {MIN_CONTRAST}:1.
        </li>
      ))}
    </ul>
  );
}

/** <input type=color> only knows #rrggbb; picking keeps the token's alpha. */
function pickedWithAlpha(picked: string, current: string): string {
  const p = parseHex(picked), c = parseHex(current);
  return p ? toHex({ ...p, a: c?.a ?? 1 }) : picked;
}

const TokenRow = memo(function TokenRow({ token, value, overridden, onSet, onReset }: {
  token: Token;
  value: string;
  overridden: boolean;
  onSet: (t: Token, v: string) => void;
  onReset: (t: Token) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const valid = isHex(text);
  const id = `token-${token}`;
  return (
    <div className="flex items-center gap-3 py-1.5">
      <input
        type="color"
        value={value.slice(0, 7)}
        onChange={(e) => onSet(token, pickedWithAlpha(e.target.value, value))}
        aria-label={`${TOKEN_LABELS[token]} color`}
        className="h-8 w-8 shrink-0 cursor-pointer rounded-full border border-[var(--c-outline)] bg-transparent p-0"
      />
      <label htmlFor={id} className="min-w-0 flex-1 truncate text-sm">
        {TOKEN_LABELS[token]}
        {overridden && <span className="ml-2 text-xs text-[var(--c-accent)]">custom</span>}
      </label>
      <input
        id={id}
        value={text}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          if (isHex(e.target.value)) onSet(token, e.target.value.trim().toLowerCase());
        }}
        onBlur={() => setText(value)}
        aria-invalid={!valid}
        className={`h-8 w-28 rounded-[var(--radius)] border bg-[var(--c-bg)] px-2 font-mono text-xs outline-none ${
          valid ? "border-[var(--c-outline)] focus:border-[var(--c-text-subtle)]" : "border-[var(--c-error)]"
        }`}
      />
      <button className="icon-btn h-8 w-8 shrink-0" disabled={!overridden} onClick={() => onReset(token)} aria-label={`Reset ${TOKEN_LABELS[token]}`} title="Reset to palette">
        <RotateCcw size={14} />
      </button>
    </div>
  );
});

export type EditorView = "simple" | "advanced";

/**
 * Tokens with a picker, a hex field (#rgb, #rrggbb, #rrggbbaa) and a per-token reset: the main colors in the
 * Simple view, every token in Advanced.
 */
export default function ColorEditor({ view, tokens, overrides, onChange }: {
  view: EditorView;
  tokens: TokenMap;
  overrides: Partial<Record<Token, string>>;
  onChange: (overrides: Partial<Record<Token, string>>) => void;
}) {
  const set = (t: Token, v: string) => onChange({ ...overrides, [t]: v });
  const reset = (t: Token) => {
    const { [t]: _, ...rest } = overrides;
    onChange(rest);
  };
  const shown = view === "simple" ? SIMPLE_TOKENS : TOKENS;
  const hidden = view === "simple" ? Object.keys(overrides).filter((t) => !SIMPLE_TOKENS.includes(t as Token)).length : 0;
  return (
    <>
      <div className="grid gap-x-8 md:grid-cols-2">
        {shown.map((t) => <TokenRow key={t} token={t} value={tokens[t]} overridden={!!overrides[t]} onSet={set} onReset={reset} />)}
      </div>
      {hidden > 0 && (
        <p className="mt-2 text-sm text-[var(--c-text-muted)]">
          {hidden} more custom {hidden === 1 ? "color is" : "colors are"} set in the Advanced view.
        </p>
      )}
    </>
  );
}
