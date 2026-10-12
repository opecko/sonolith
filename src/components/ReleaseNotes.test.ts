import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseNotes } from "./ReleaseNotes";

describe("parseNotes", () => {
  it("joins wrapped bullet and paragraph lines and drops the downloads table", () => {
    const blocks = parseNotes(readFileSync(new URL("./__fixtures__/release-notes-1.2.1.md", import.meta.url), "utf8"));
    expect(blocks[0]).toEqual({ kind: "h", text: "Smoother and lighter" });
    const first = blocks.find((b) => b.kind === "ul");
    expect(first?.kind === "ul" && first.items[0]).toMatch(/^\*\*Now Playing opens and closes cleanly\.\*\* .* animation ends\.$/);
    const all = JSON.stringify(blocks);
    expect(all).not.toMatch(/Downloads|SHA256SUMS|Full diff/);
    // No wrapped line ended up as a block of its own.
    expect(blocks.filter((b) => b.kind === "p").every((b) => b.kind === "p" && /^[A-Z*]/.test(b.text))).toBe(true);
  });

  it("keeps separate paragraphs and lists apart", () => {
    expect(parseNotes("One\n  two\n\nThree\n- a\n  b\n- c")).toEqual([
      { kind: "p", text: "One two" },
      { kind: "p", text: "Three" },
      { kind: "ul", items: ["a b", "c"] },
    ]);
  });
});
