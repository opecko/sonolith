import { describe, expect, it } from "vitest";
import { loggedInFlag, makeYtFetch } from "./innertube";

describe("makeYtFetch", () => {
  const capture = () => {
    const calls: { url: string; headers: Headers; body?: unknown }[] = [];
    const base = (async (u: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(u), headers: new Headers(init?.headers), body: init?.body });
      return new Response("{}");
    }) as typeof fetch;
    return { calls, f: makeYtFetch(base, { cookie: () => "SAPISID=abc; SID=x", authUser: () => 1, pageId: () => "42" }) };
  };

  it("routes WEB_REMIX calls to music host with matching origin and auth", async () => {
    const { calls, f } = capture();
    await f("https://www.youtube.com/youtubei/v1/browse", { method: "POST", body: '{"context":{"client":{"clientName":"WEB_REMIX"}}}' });
    const { url, headers } = calls[0];
    expect(url).toBe("https://music.youtube.com/youtubei/v1/browse");
    expect(headers.get("Origin")).toBe("https://music.youtube.com");
    expect(headers.get("X-Goog-AuthUser")).toBe("1");
    expect(headers.get("Authorization")).toMatch(/^SAPISIDHASH \d+_[0-9a-f]{40}$/);
  });

  it("keeps www origin for other clients and leaves non-API urls alone", async () => {
    const { calls, f } = capture();
    await f("https://www.youtube.com/youtubei/v1/player", { method: "POST", body: '{"clientName":"WEB"}' });
    await f("https://www.youtube.com/iframe_api");
    expect(calls[0].headers.get("Origin")).toBe("https://www.youtube.com");
    expect(calls[1].headers.get("Cookie")).toBeNull();
  });

  it("authenticates playback stats pings (watch history)", async () => {
    const { calls, f } = capture();
    await f("https://s.youtube.com/api/stats/playback?docid=x&ver=2", { method: "GET" });
    expect(calls[0].headers.get("Cookie")).toContain("SAPISID");
    expect(calls[0].headers.get("Authorization")).toMatch(/^SAPISIDHASH /);
    expect(calls[0].headers.get("Origin")).toBe("https://s.youtube.com");
  });

  it("sends mobile clients without cookie auth", async () => {
    const { calls, f } = capture();
    await f("https://www.youtube.com/youtubei/v1/player", { method: "POST", body: '{"clientName":"ANDROID"}', headers: { Cookie: "SAPISID=x", Authorization: "SAPISIDHASH 1_a" } });
    expect(calls[0].headers.get("Cookie")).toBeNull();
    expect(calls[0].headers.get("Authorization")).toBeNull();
  });

  it("sends VISIONOS (stream fallback for non-Premium accounts) without cookie auth", async () => {
    const { calls, f } = capture();
    await f("https://www.youtube.com/youtubei/v1/player", { method: "POST", body: '{"context":{"client":{"clientName":"VISIONOS"}}}', headers: { Cookie: "SAPISID=x" } });
    expect(calls[0].headers.get("Cookie")).toBeNull();
    expect(calls[0].headers.get("Origin")).toBe("https://www.youtube.com");
  });

  it("acts as the brand account except for anonymous mobile clients and the account list", async () => {
    const { calls, f } = capture();
    await f("https://www.youtube.com/youtubei/v1/browse", { method: "POST", body: '{"context":{"client":{"clientName":"WEB_REMIX"}}}' });
    const visionos = '{"context":{"client":{"clientName":"VISIONOS"},"user":{"onBehalfOfUser":"42"}}}';
    await f("https://www.youtube.com/youtubei/v1/player", { method: "POST", body: visionos, headers: { "X-Goog-PageId": "42" } });
    await f("https://music.youtube.com/getAccountSwitcherEndpoint", { method: "GET" });
    expect(calls[0].headers.get("X-Goog-PageId")).toBe("42");
    expect(calls[1].headers.get("X-Goog-PageId")).toBeNull();
    expect(JSON.parse(String(calls[1].body)).context.user).toEqual({});
    expect(calls[2].headers.get("Cookie")).toContain("SAPISID");
    expect(calls[2].headers.get("X-Goog-PageId")).toBeNull();
  });
});

it("reads logged_in tracking param", () => {
  const d = { responseContext: { serviceTrackingParams: [{ params: [{ key: "logged_in", value: "1" }] }] } };
  expect(loggedInFlag(d)).toBe(true);
  expect(loggedInFlag({})).toBeNull();
});
