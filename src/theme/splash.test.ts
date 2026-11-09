import { describe, expect, it } from "vitest";
import { splashFor } from "./splash";

describe("startup screen colors", () => {
  it("saves the background and text opaque, with a valid opacity", () => {
    expect(splashFor({ bg: "#11223380", text: "#ffffffb3" }, 0.1)).toEqual({ bg: "#112233", fg: "#ffffff", opacity: 0.3 });
    expect(splashFor({ bg: "#000000", text: "#ffffff" }, 0.85)).toEqual({ bg: "#000000", fg: "#ffffff", opacity: 0.85 });
  });

});
