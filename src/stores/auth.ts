import { create } from "zustand";
import { SNAPSHOT_KEY } from "./queueSnapshot";
import { invoke } from "@tauri-apps/api/core";
import { logPlayback } from "../api/stream";
import { currentAccount, getCookie, resetClient, setAccount, setAuthExpiredHandler } from "../api/client";
import { DEFAULT_ACCOUNT, sameAccount, type AccountChoice } from "../api/accounts";
import { clearDataCache } from "../hooks/useData";
import { useLibrary } from "./library";
import { useToast } from "./toast";

type Status = "loading" | "signedOut" | "signedIn";

interface AuthState {
  status: Status;
  error: string | null;
  /** Bumped on every account change (sign-in, switch): views keyed on it load the new account's data. */
  accountGen: number;
  init: () => Promise<void>;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  /** Acts as another account or channel of the signed-in cookie (account switcher). */
  switchAccount: (choice: AccountChoice) => void;
}

export const useAuth = create<AuthState>((set, get) => {
  const changed = (choice: AccountChoice) => {
    setAccount(choice);
    resetClient();
    clearDataCache();
    useLibrary.getState().reset();
    set({ accountGen: get().accountGen + 1 });
  };
  setAuthExpiredHandler(() => {
    // A switched-to account that's gone from the cookie answers 401 too: fall back to the main one, keep the session.
    if (!sameAccount(currentAccount(), DEFAULT_ACCOUNT)) {
      changed(DEFAULT_ACCOUNT);
      useToast.getState().show("That account isn't available any more. Switched back to your main account");
      return;
    }
    clearDataCache();
    invoke("auth_clear").catch(() => {});
    set({ status: "signedOut", error: "Session expired, please sign in again" });
  });
  return {
  status: "loading",
  error: null,
  accountGen: 0,
  init: async () => {
    const cookie = await getCookie().catch(() => null);
    set({ status: cookie ? "signedIn" : "signedOut" });
  },
  login: async () => {
    set({ error: null });
    try {
      await invoke<string>("auth_login");
      changed(DEFAULT_ACCOUNT);
      set({ status: "signedIn" });
    } catch (e) {
      // Shown wherever Sign in was pressed (the top bar's button has no place of its own for it), and in the
      // playback log: the one file a user can send when sign-in fails on their machine.
      if (String(e) !== "login cancelled") {
        logPlayback(`sign-in failed: ${String(e)}`);
        useToast.getState().show(`Sign-in failed: ${String(e)}`);
      }
      set({ error: String(e) });
    }
  },
  logout: async () => {
    await invoke("auth_clear");
    try {
      localStorage.removeItem(SNAPSHOT_KEY); // the saved queue belongs to the signed-out account
    } catch {
      /* storage unavailable */
    }
    changed(DEFAULT_ACCOUNT);
    set({ status: "signedOut" });
  },
  switchAccount: (choice) => {
    if (sameAccount(choice, currentAccount())) return;
    changed(choice);
  },
};
});
