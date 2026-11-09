import { describe, expect, it } from "vitest";
import { DEFAULT_TOKENS } from "../theme/tokens";
import { REMOTE_TOKENS, remoteTheme } from "./theme";

describe("remoteTheme", () => {
  it("sends the page's tokens and whether the theme is light", () => {
    const dark = remoteTheme({ ...DEFAULT_TOKENS });
    expect(Object.keys(dark.tokens)).toEqual([...REMOTE_TOKENS]);
    expect(dark.tokens.accent).toBe(DEFAULT_TOKENS.accent);
    expect(dark.tokens).not.toHaveProperty("scrim");
    expect(dark.light).toBe(false);
    expect(remoteTheme({ ...DEFAULT_TOKENS, bg: "#fafafa" }).light).toBe(true);
  });
});
