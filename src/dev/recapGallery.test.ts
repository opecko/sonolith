import { describe, expect, it } from "vitest";
import { dayFromYmd as D, startOfDay } from "../recap/days";
import { mergePlays } from "../recap/merge";
import { periodEnd } from "../recap/periods";
import { buildSnapshot } from "../recap/snapshot";
import { fits, STYLE_IDS } from "../recap/styles";
import { syntheticLog } from "../recap/synthetic";
import { galleryDeck } from "./recapGallery";

describe("style gallery", () => {
  it("shows every style once, each with data it can draw", () => {
    const y = { kind: "year" as const, year: 2026 };
    const snap = buildSnapshot(y, mergePlays(syntheticLog(2026), []), periodEnd(y), startOfDay(D(2026, 11, 2)), { frozen: false, podcasts: false, youtube: false });
    const deck = galleryDeck(snap);
    expect(deck.slides.map((s) => s.style)).toEqual(STYLE_IDS);
    for (const s of deck.slides) {
      const d = s.useAlt ? s.alt! : s.data;
      expect(fits(s.style!, d.shape, d.shape === "series" ? d.values.length : undefined), s.style!).toBe(true);
    }
  });
});
