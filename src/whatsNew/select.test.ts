import { describe, expect, it } from "vitest";
import { Sparkles } from "lucide-react";
import { compareVersions, pickWhatsNew } from "./select";
import { WHATS_NEW } from "./entries";
import type { WhatsNewEntry } from "./types";

const E = (version: string): WhatsNewEntry => ({ version, title: version, highlights: [{ icon: Sparkles, title: "x", text: "y" }] });
const entries = [E("2.0.0"), E("1.5.0")];

describe("version comparison", () => {
  it("compares numerically, not as text", () => {
    expect(compareVersions("2.0.0", "1.3.0")).toBe(1);
    expect(compareVersions("1.10.0", "1.9.0")).toBe(1);
    expect(compareVersions("1.3.0", "2.0.0")).toBe(-1);
    expect(compareVersions("v2.0.0", "2.0")).toBe(0);
    expect(compareVersions("2.0.0-beta", "2.0.0")).toBe(0);
    expect(compareVersions("garbage", "1.0.0")).toBe(0);
  });
});

describe("What's new selection", () => {
  it("fresh install: saves the version, shows nothing", () => {
    expect(pickWhatsNew("2.0.0", null, true, entries)).toEqual({ show: null, save: "2.0.0" });
  });

  it("upgrade from 1.x (settings without lastSeenVersion) shows the entry", () => {
    expect(pickWhatsNew("2.0.0", null, false, entries)).toEqual({ show: entries[0], save: "2.0.0" });
  });

  it("newer version with an entry shows it once", () => {
    expect(pickWhatsNew("2.0.0", "1.3.0", false, entries).show?.version).toBe("2.0.0");
    expect(pickWhatsNew("2.0.0", "2.0.0", false, entries)).toEqual({ show: null, save: null });
  });

  it("a version without an entry shows nothing but is saved", () => {
    expect(pickWhatsNew("2.0.1", "2.0.0", false, entries)).toEqual({ show: null, save: "2.0.1" });
  });

  it("a downgrade shows nothing", () => {
    expect(pickWhatsNew("1.5.0", "2.0.0", false, entries)).toEqual({ show: null, save: "1.5.0" });
  });

  it("the bundled entries are valid and newest first", () => {
    for (const e of WHATS_NEW) expect(e.highlights.length).toBeGreaterThan(0);
    for (let i = 1; i < WHATS_NEW.length; i++) expect(compareVersions(WHATS_NEW[i - 1].version, WHATS_NEW[i].version)).toBe(1);
    expect(WHATS_NEW.some((e) => e.version === "2.0.0")).toBe(true);
  });
});
