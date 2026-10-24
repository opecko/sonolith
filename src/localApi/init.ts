// The frontend side of the local API: answers `api:call`s from the server, publishes state, keeps consent requests.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { setLyricsWantedByApps } from "../lyrics/store";
import { useToast } from "../stores/toast";
import { dispatch, type Call } from "./dispatch";
import { bridgeError } from "./errors";
import { initPublishing, publishAll, setPublishing } from "./publish";
import { useLocalApi, type Consent } from "./store";

interface ApiCall extends Call {
  id: number;
  method: string;
  params: Record<string, unknown>;
}

let started = false;

export async function initLocalApi() {
  // StrictMode runs effects twice; two listeners would answer every call twice.
  if (started) return;
  started = true;
  initPublishing();
  const api = useLocalApi;
  await listen<ApiCall>("api:call", ({ payload: c }) => {
    dispatch(c.method, c.params ?? {}, { appId: c.appId, scopes: c.scopes }).then(
      (result) => invoke("api_reply", { id: c.id, result: result ?? {}, error: null }),
      (e) => invoke("api_reply", { id: c.id, result: null, error: bridgeError(e) }),
    ).catch(() => {});
  });
  await listen<Consent>("api:consent", ({ payload }) =>
    api.setState((s) => ({ consents: [...s.consents.filter((c) => c.requestId !== payload.requestId), payload] })));
  await listen<{ requestId: string }>("api:consent-cancel", ({ payload }) =>
    api.setState((s) => ({ consents: s.consents.filter((c) => c.requestId !== payload.requestId) })));
  await listen("api:apps-changed", () => void api.getState().loadApps().catch(() => {}));
  await listen<boolean>("api:lyrics-wanted", ({ payload }) => setLyricsWantedByApps(payload));
  await listen<{ message: string }>("api:toast", ({ payload }) => useToast.getState().show(payload.message, "info"));
  // The state only matters to the server while it runs.
  api.subscribe((s, p) => s.status?.running !== p.status?.running && setPublishing(!!s.status?.running));
  await api.getState().refresh().catch(() => {});
  // After a reload, the server may have requests waiting and apps that want lyrics.
  const ready = await invoke<{ lyricsWanted: boolean; consents: Consent[] }>("api_ready").catch(() => null);
  if (ready) {
    api.setState({ consents: ready.consents });
    setLyricsWantedByApps(ready.lyricsWanted);
  }
  publishAll();
}
