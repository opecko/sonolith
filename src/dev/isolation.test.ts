import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = new URL("..", import.meta.url).pathname;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|css)$/.test(f) ? [p] : [];
  });
}

describe("dev toolkit isolation", () => {
  it("nothing outside src/dev imports it, except main.tsx's guarded dynamic import", () => {
    const offenders: string[] = [];
    for (const f of files(SRC)) {
      const rel = relative(SRC, f);
      if (rel.startsWith("dev/")) continue;
      const code = readFileSync(f, "utf8");
      // Static imports or re-exports of anything under src/dev.
      if (/(?:import|export)[^;'"]*from\s*["'][./]*\/?dev(?:\/[^"']*)?["']/.test(code)) offenders.push(rel);
      if (/import\(["'][./]*\/?dev/.test(code) && rel !== "main.tsx") offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("main.tsx loads it only behind import.meta.env.DEV", () => {
    const main = readFileSync(join(SRC, "main.tsx"), "utf8");
    const line = main.split("\n").find((l) => l.includes('import("./dev")'));
    expect(line).toMatch(/^if \(import\.meta\.env\.DEV\) /);
  });
});
