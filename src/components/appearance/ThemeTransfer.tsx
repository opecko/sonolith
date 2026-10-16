import { Check, Copy, FileUp, X } from "lucide-react";
import { useEffect, useState } from "react";
import { normalizeAppearance, type Appearance } from "../../theme/appearance";

/** Theme file: the whole Appearance settings plus a marker, so other JSON is rejected. */
export function exportTheme(a: Appearance): string {
  return JSON.stringify({ ytdeskTheme: 1, appearance: a }, null, 2);
}

export function importTheme(text: string): Appearance {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This isn't valid JSON.");
  }
  const d = data as { ytdeskTheme?: unknown; appearance?: unknown };
  if (!d || typeof d !== "object" || d.ytdeskTheme !== 1 || !d.appearance) throw new Error("This isn't a ytdesk theme.");
  return normalizeAppearance(d.appearance);
}

/**
 * Export shows the JSON to copy; import takes pasted JSON or a file. (Plain text instead of downloads: the
 * webview has no save dialog.)
 */
export default function ThemeTransfer({ kind, current, onImport, onClose }: {
  kind: "export" | "import";
  current: Appearance;
  onImport: (a: Appearance) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(kind === "export" ? exportTheme(current) : "");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const apply = () => {
    try {
      onImport(importTheme(text));
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setError("Couldn't copy; select the text and copy it instead.");
    }
  };
  const loadFile = async (f: File | undefined) => {
    if (f) setText(await f.text());
    setError("");
  };

  const btn = "flex h-9 items-center gap-2 rounded-full px-4 text-sm font-medium";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--c-overlay)] p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={kind === "export" ? "Export theme" : "Import theme"}
        className="m3-dialog flex max-h-full w-[min(560px,100%)] flex-col gap-3 rounded-lg border border-[var(--c-outline)] bg-[var(--c-surface-3)] p-6 shadow-2xl">
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{kind === "export" ? "Export theme" : "Import theme"}</h2>
          <button className="icon-btn h-9 w-9" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </header>
        <p className="text-sm text-[var(--c-text-muted)]">
          {kind === "export" ? "Palette, custom colors and the other appearance options. Save it or share it." : "Paste a theme exported from ytdesk, or open the file."}
        </p>
        <textarea
          value={text}
          readOnly={kind === "export"}
          autoFocus
          onChange={(e) => {
            setText(e.target.value);
            setError("");
          }}
          onFocus={(e) => kind === "export" && e.currentTarget.select()}
          spellCheck={false}
          aria-label="Theme JSON"
          className="h-64 resize-none select-text rounded-[var(--radius)] border border-[var(--c-outline)] bg-[var(--c-bg)] p-3 font-mono text-xs outline-none focus:border-[var(--c-text-subtle)]"
        />
        {error && <p className="text-sm text-[var(--c-error)]">{error}</p>}
        <div className="flex justify-end gap-2">
          {kind === "export" ? (
            <button className={`${btn} m3-btn m3-filled bg-button text-on-button`} onClick={copy}>
              {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />} {copied ? "Copied" : "Copy"}
            </button>
          ) : (
            <>
              <label className={`${btn} m3-btn m3-outlined cursor-pointer border border-[var(--c-outline)] hover:bg-[var(--c-hover)]`}>
                <FileUp size={16} aria-hidden /> Open file
                <input type="file" accept=".json,application/json" className="hidden" onChange={(e) => void loadFile(e.target.files?.[0])} />
              </label>
              <button className={`${btn} m3-btn m3-filled bg-button text-on-button disabled:opacity-50`} disabled={!text.trim()} onClick={apply}>Apply</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
