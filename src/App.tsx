import { lazy, Suspense, useEffect } from "react";
import { useAuth } from "./stores/auth";
import { initDiscord } from "./stores/discord";
import { initMpris } from "./stores/mpris";
import { initHistory } from "./stores/history";
import { initHistoryImport } from "./recap/importer";
import { initPlayLog } from "./recap/recorder";
import { initRecaps } from "./recap/store";
import { useRecapUi } from "./recap/ui";
import { initMediaKeys, initTray } from "./stores/mediaKeys";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import PlayerBar from "./components/PlayerBar";
import MainView from "./views/MainView";
import NowPlaying from "./views/NowPlaying";
import { useUi } from "./stores/ui";
import Toast from "./components/Toast";
import { initLyrics } from "./lyrics/store";
import { initLocalApi } from "./localApi/init";
import ConsentDialog from "./localApi/ConsentDialog";
import { initShortcuts } from "./shortcuts/init";
import ShortcutFeedback from "./shortcuts/ShortcutFeedback";
import { browseLinks } from "./components/TrackByline";
import ConfirmDialog from "./components/ConfirmDialog";
import CreditsDialog from "./components/CreditsDialog";
import UpdateDialog from "./components/UpdateDialog";
import { initUpdates } from "./stores/update";
import WhatsNewDialog from "./whatsNew/WhatsNewDialog";
import { initOnboarding, useOnboarding } from "./onboarding/store";

// The welcome is only ever needed on a fresh install: its code loads when it opens.
const Onboarding = lazy(() => import("./onboarding/Onboarding"));
// The recap story player (and its card styles) loads the first time a recap opens.
const RecapPlayer = lazy(() => import("./recap/player/RecapPlayer"));

export default function App() {
  // WebKit keeps painting content under an opaque overlay; hiding it makes Now Playing hover/scroll cheap.
  const covered = useUi((s) => s.nowPlayingCovering);
  const onboarding = useOnboarding((s) => s.open);
  const recapOpen = useRecapUi((s) => !!s.open);
  useEffect(() => {
    useAuth.getState().init();
    initMediaKeys();
    void initTray();
    initDiscord();
    void initMpris();
    initHistory();
    initPlayLog();
    initHistoryImport();
    initRecaps();
    initUpdates();
    void initOnboarding();
    initShortcuts();
    initLyrics();
    void initLocalApi();
  }, []);
  // One delegated handler for every artist / album link in the app (TrackByline): rows carry only data-* attributes.
  return (
    <div className="flex h-full flex-col" {...browseLinks}>
      <div data-np-under="" className={`flex min-h-0 flex-1 ${covered ? "invisible" : ""}`}>
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <MainView />
        </div>
      </div>
      <NowPlaying />
      <PlayerBar />
      <CreditsDialog />
      <UpdateDialog />
      <WhatsNewDialog />
      <ConfirmDialog />
      <ConsentDialog />
      <Toast />
      <ShortcutFeedback />
      {onboarding && <Suspense fallback={null}><Onboarding /></Suspense>}
      {recapOpen && <Suspense fallback={null}><RecapPlayer /></Suspense>}
    </div>
  );
}
