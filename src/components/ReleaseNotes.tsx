import type { ReactNode } from "react";

type Block = { kind: "h"; text: string } | { kind: "p"; text: string } | { kind: "ul"; items: string[] };

/**
 * The subset of Markdown our GitHub release notes use: "#" headings, "- " bullets and paragraphs, where a line
 * that starts with spaces continues the bullet or paragraph above it (notes are wrapped at ~120 columns). The
 * download table and the diff link at the end are dropped.
 */
export function parseNotes(markdown: string): Block[] {
  const lines = markdown.replace(/\r/g, "").split("\n");
  const end = lines.findIndex((l) => /^##\s+Downloads/i.test(l));
  const blocks: Block[] = [];
  let open: { add: (t: string) => void } | null = null;
  for (const line of lines.slice(0, end < 0 ? undefined : end)) {
    const t = line.trim();
    if (!t || /^\*\*Full diff/i.test(t)) {
      if (!t) open = null;
      continue;
    }
    const continues = /^\s/.test(line) && open && !/^[-*]\s+/.test(t);
    if (continues) {
      open!.add(t);
      continue;
    }
    if (/^#+\s+/.test(t)) {
      blocks.push({ kind: "h", text: t.replace(/^#+\s+/, "") });
      open = null;
    } else if (/^[-*]\s+/.test(t)) {
      let list = blocks.at(-1);
      if (list?.kind !== "ul") blocks.push((list = { kind: "ul", items: [] }));
      const items = list.items;
      items.push(t.replace(/^[-*]\s+/, ""));
      open = { add: (s) => (items[items.length - 1] += ` ${s}`) };
    } else {
      const last = blocks.at(-1);
      if (last?.kind === "p" && open) last.text += ` ${t}`;
      else {
        const p = { kind: "p" as const, text: t };
        blocks.push(p);
        open = { add: (s) => (p.text += ` ${s}`) };
      }
    }
  }
  return blocks;
}

/** **bold** stays bold; `code` and [links](…) become plain text. */
function inline(s: string): ReactNode[] {
  const plain = s.replace(/`/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  return plain.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i} className="font-semibold text-[var(--c-text)]">{part}</strong> : part));
}

export default function ReleaseNotes({ markdown }: { markdown: string }) {
  const blocks = parseNotes(markdown);
  if (!blocks.length) return <p>No release notes.</p>;
  return (
    <>
      {blocks.map((b, i) =>
        b.kind === "h" ? (
          <h3 key={i} className="mb-2 mt-1 text-sm font-semibold text-[var(--c-text)]">{inline(b.text)}</h3>
        ) : b.kind === "ul" ? (
          <ul key={i} className="mb-3 list-disc space-y-1 pl-5">{b.items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ul>
        ) : (
          <p key={i} className="mb-3">{inline(b.text)}</p>
        ),
      )}
    </>
  );
}
