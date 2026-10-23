import { describe, expect, it } from "vitest";
import { errorText, isNetworkError } from "./errors";

describe("errors", () => {
  it("recognizes connection failures", () => {
    expect(isNetworkError(new Error("error sending request for url (https://music.youtube.com/youtubei/v1/browse)"))).toBe(true);
    expect(isNetworkError("dns error: failed to lookup address information")).toBe(true);
    expect(isNetworkError(new Error("wrapped", { cause: new Error("connection refused") }))).toBe(true);
    expect(isNetworkError(new Error("This playlist cannot be edited."))).toBe(false);
  });

  it("keeps other messages", () => {
    expect(errorText(new Error("No credits for this song"))).toBe("No credits for this song");
    expect(errorText(new Error("error sending request"))).toMatch(/No internet connection/);
  });
});
