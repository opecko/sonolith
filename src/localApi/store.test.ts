// Consent answers only count once the request has been on screen for a moment, so a click meant for something else
// (or the second click of a double click) can't approve an app that just popped up.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { CONSENT_ARM_MS, useLocalApi, type Consent } from "./store";

const consent = (requestId: string): Consent => ({
  requestId, kind: "register", appId: `com.example.${requestId}`, name: requestId, publisher: "p", description: "d", homepage: null, icon: null,
  identity: { kind: "executable", key: "exe:/x", executable: "/x", interpreter: null, script: null, appImage: null, flatpakId: null },
  previousIdentity: null, alreadyRegistered: false, grantedScopes: [], scopes: [], expiresAt: 0,
});
const show = (...c: Consent[]) => useLocalApi.setState((s) => ({ consents: [...s.consents, ...c] }));
const answer = (id: string) => useLocalApi.getState().answer(id, "allow", []);
const answered = () => invoke.mock.calls.filter((c) => c[0] === "api_consent_answer").map((c) => c[1].requestId);

beforeEach(() => {
  vi.useFakeTimers();
  invoke.mockClear();
  useLocalApi.setState({ consents: [] });
});
afterEach(() => vi.useRealTimers());

describe("consent answers", () => {
  it("are ignored until the request has been shown for a moment", async () => {
    show(consent("a"));
    await answer("a");
    expect(answered()).toEqual([]);
    expect(useLocalApi.getState().consents).toHaveLength(1);
    vi.advanceTimersByTime(CONSENT_ARM_MS);
    await answer("a");
    expect(answered()).toEqual(["a"]);
  });

  it("start over when the next request takes its place, so a double click doesn't answer both", async () => {
    show(consent("a"), consent("b"));
    vi.advanceTimersByTime(CONSENT_ARM_MS);
    await answer("a");
    await answer("b");
    expect(answered()).toEqual(["a"]);
    vi.advanceTimersByTime(CONSENT_ARM_MS);
    await answer("b");
    expect(answered()).toEqual(["a", "b"]);
  });

  it("only count for the request on screen", async () => {
    show(consent("a"), consent("b"));
    vi.advanceTimersByTime(CONSENT_ARM_MS);
    await answer("b");
    expect(answered()).toEqual([]);
    // A cancelled request in front: the next one waits its own moment.
    useLocalApi.setState((s) => ({ consents: s.consents.slice(1) }));
    await answer("b");
    expect(answered()).toEqual([]);
  });
});
