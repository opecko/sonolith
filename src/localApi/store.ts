// The local API as the UI sees it: on/off and where it listens, and the consent requests waiting for the user.
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { AppIdentity, Scope } from "./schema.gen";

export interface ApiStatus {
  enabled: boolean;
  running: boolean;
  /** The socket path or pipe name while running. */
  path: string | null;
  /** Why the endpoint could not start. */
  error: string | null;
  specUrl: string;
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
  previousIdentity: AppIdentity | null;
  alreadyRegistered: boolean;
  /** For a scope request: what the app has already. */
  grantedScopes: Scope[];
  scopes: { scope: Scope; required: boolean; reason: string; label: string; sensitive: boolean }[];
  expiresAt: number;
}

interface LocalApiState {
  status: ApiStatus | null;
  consents: Consent[];
  refresh: () => Promise<void>;
  /** Turns the API on or off; the error, if the endpoint can't start, ends up in `status.error`. */
  setEnabled: (on: boolean) => Promise<void>;
  answer: (requestId: string, decision: "allow" | "deny" | "block", scopes: Scope[]) => Promise<void>;
}

export const useLocalApi = create<LocalApiState>((set) => ({
  status: null,
  consents: [],
  refresh: async () => set({ status: await invoke<ApiStatus>("api_status") }),
  setEnabled: async (enabled) => {
    try {
      set({ status: await invoke<ApiStatus>("api_set_enabled", { enabled }) });
    } catch {
      set({ status: await invoke<ApiStatus>("api_status") });
    }
  },
  answer: async (requestId, decision, scopes) => {
    set((s) => ({ consents: s.consents.filter((c) => c.requestId !== requestId) }));
    await invoke("api_consent_answer", { requestId, decision, scopes }).catch(() => {});
  },
}));
