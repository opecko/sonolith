// The local API as the UI sees it: on/off and where it listens, and the consent requests waiting for the user.
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { Hold } from "./apps";
import type { AppIdentity, Scope } from "./schema.gen";

export interface ApiStatus {
  enabled: boolean;
  running: boolean;
  /** The socket path or pipe name while running. */
  path: string | null;
  /** Why the endpoint could not start. */
  error: string | null;
}

/** A registered app with its live state (src-tauri/src/api/server.rs `apps`). */
export interface ConnectedApp {
  appId: string;
  name: string;
  description: string;
  publisher: string;
  homepage: string | null;
  icon: string | null;
  identity: AppIdentity;
  scopes: Scope[];
  registeredAt: number;
  lastUsedAt: number | null;
  /** Open connections right now. */
  connections: number;
  /** Newest first, at most 50 calls (this session only). */
  activity: { method: string; at: number }[];
}

export interface BlockedApp {
  appId: string;
  identityKey: string;
  name: string;
  identity: AppIdentity;
  blockedAt: number;
  /** Blocks the app id too (blocked in Settings); otherwise only this program (blocked on a consent screen). */
  appWide: boolean;
}

/** A registration, scope or identity request (src-tauri/src/api/server.rs `consent_payload`). */
export interface Consent {
  requestId: string;
  kind: "register" | "scopes" | "identity";
  appId: string;
  name: string;
  publisher: string;
  description: string;
  homepage: string | null;
  icon: string | null;
  identity: AppIdentity;
  /** The program allowed before: for an identity change, and for a registration under an id another program has. */
  previousIdentity: AppIdentity | null;
  alreadyRegistered: boolean;
  /** For a scope request: what the app has already. */
  grantedScopes: Scope[];
  scopes: { scope: Scope; required: boolean; reason: string; label: string; sensitive: boolean }[];
  expiresAt: number;
}

/**
 * How long a consent request must be on screen before an answer counts: a click meant for what was there before (or
 * the second click of a double click on the previous request) must not approve an app that just appeared.
 */
export const CONSENT_ARM_MS = 1000;

interface LocalApiState {
  status: ApiStatus | null;
  /** Waiting requests; the first one is on screen. */
  consents: Consent[];
  /** When the request now on screen got there (`Date.now()`). */
  frontSince: number;
  apps: ConnectedApp[];
  blocked: BlockedApp[];
  /** Apps that were denied (or not answered) recently and may not ask again yet. */
  onHold: Hold[];
  /** The saved list of apps couldn't be read at startup: what happened to it. */
  registryProblem: string | null;
  refresh: () => Promise<void>;
  /** Registered and blocked apps; follows `api:apps-changed`. */
  loadApps: () => Promise<void>;
  /** Turns the API on or off; the error, if the endpoint can't start, ends up in `status.error`. */
  setEnabled: (on: boolean) => Promise<void>;
  /** Answers the request on screen; ignored for any other request and until it has been shown `CONSENT_ARM_MS`. */
  answer: (requestId: string, decision: "allow" | "deny" | "block", scopes: Scope[]) => Promise<void>;
}

export const useLocalApi = create<LocalApiState>((set, get) => ({
  status: null,
  consents: [],
  frontSince: 0,
  apps: [],
  blocked: [],
  onHold: [],
  registryProblem: null,
  refresh: async () => set({ status: await invoke<ApiStatus>("api_status") }),
  loadApps: async () => {
    const r = await invoke<{
      apps: ConnectedApp[];
      blocked: BlockedApp[];
      onHold?: { appId: string; name: string; expired: boolean; retryAfterMs: number }[];
      registryProblem: string | null;
    }>("api_apps");
    const now = Date.now();
    const onHold = (r.onHold ?? []).map((h) => ({ appId: h.appId, name: h.name, expired: h.expired, until: now + h.retryAfterMs }));
    set({ apps: r.apps, blocked: r.blocked, onHold, registryProblem: r.registryProblem });
  },
  setEnabled: async (enabled) => {
    try {
      set({ status: await invoke<ApiStatus>("api_set_enabled", { enabled }) });
    } catch {
      set({ status: await invoke<ApiStatus>("api_status") });
    }
  },
  answer: async (requestId, decision, scopes) => {
    const { consents, frontSince } = get();
    if (consents[0]?.requestId !== requestId || Date.now() - frontSince < CONSENT_ARM_MS) return;
    set((s) => ({ consents: s.consents.filter((c) => c.requestId !== requestId) }));
    await invoke("api_consent_answer", { requestId, decision, scopes }).catch(() => {});
  },
}));

// Every change of the request on screen restarts the wait, however the list changed (new, answered, cancelled).
useLocalApi.subscribe((s, p) => {
  if (s.consents[0]?.requestId !== p.consents[0]?.requestId) useLocalApi.setState({ frontSince: Date.now() });
});
