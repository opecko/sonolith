import { describe, expect, it } from "vitest";
import { sizedArt } from "./Thumb";

describe("sizedArt", () => {
  it("asks googleusercontent for 2× the slot size", () => {
    expect(sizedArt("https://lh3.googleusercontent.com/abc=w240-h240-l90-rj", 40)).toBe("https://lh3.googleusercontent.com/abc=w80-h80-l90-rj");
    expect(sizedArt("https://yt3.googleusercontent.com/x=w544-h544-p-l90-rj", 48)).toBe("https://yt3.googleusercontent.com/x=w96-h96-l90-rj");
  });

  it("never upsizes and leaves other URLs alone", () => {
    expect(sizedArt("https://lh3.googleusercontent.com/abc=w60-h60-l90-rj", 40)).toBe("https://lh3.googleusercontent.com/abc=w60-h60-l90-rj");
    expect(sizedArt("https://i.ytimg.com/vi/abc/hqdefault.jpg", 40)).toBe("https://i.ytimg.com/vi/abc/hqdefault.jpg");
  });
});
