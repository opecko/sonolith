import { describe, expect, it } from "vitest";
import { contrast } from "./color";
import { RECAP_MOODS, recapPalette, recapVars, sourceHues } from "./recapPalette";

// A spread of source colors: saturated, grey, near black, near white, every hue.
const sources = [0xffff0000, 0xff00ff00, 0xff0000ff, 0xffffff00, 0xff808080, 0xff101010, 0xfff0f0f0, 0xff7a3eb1, 0xff00a3a3, 0xffe08a1e];
for (let h = 0; h < 360; h += 30) sources.push(0xff000000 | (((Math.sin(h) * 127 + 128) & 255) << 16) | (((Math.cos(h) * 127 + 128) & 255) << 8) | (h & 255));

describe("recapPalette", () => {
  it("every text pair reaches 4.5:1 in every mood", () => {
    for (const s of sources) for (const s2 of [s, 0xff2266ee]) for (const mood of RECAP_MOODS) {
      const p = recapPalette([s, s2], mood);
      const pairs: [string, string, string][] = [
        ["fg/bg", p.fg, p.bg], ["fg/bg2", p.fg, p.bg2], ["muted/bg", p.muted, p.bg], ["muted/bg2", p.muted, p.bg2],
        ["onAccent/accent", p.onAccent, p.accent], ["onAccent2/accent2", p.onAccent2, p.accent2],
      ];
      for (const [name, fg, bg] of pairs) expect(contrast(fg, bg), `${mood} ${s.toString(16)} ${name}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("moods look different", () => {
    const ps = RECAP_MOODS.map((m) => recapPalette([0xff7a3eb1], m).bg);
    expect(new Set(ps).size).toBe(RECAP_MOODS.length);
  });

  it("a second hue only when it's far enough", () => {
    expect(sourceHues([0xffff0000, 0xffff1100])[1]).not.toBeCloseTo(sourceHues([0xffff1100])[0], 0);
    expect(sourceHues([])[0]).toBeGreaterThan(0);
  });

  it("vars are hex values", () => {
    for (const v of Object.values(recapVars(recapPalette([0xff00a3a3], "vivid")))) expect(v).toMatch(/^#[0-9a-f]{6}$/);
  });
});
