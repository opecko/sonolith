import { useEffect } from "react";
import { useAuth } from "./stores/auth";
import { initDiscord } from "./stores/discord";
import { initMpris } from "./stores/mpris";
import { initHistory } from "./stores/history";
import { initMediaKeys, initTray } from "./stores/mediaKeys";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import PlayerBar from "./components/PlayerBar";
import MainView from "./views/MainView";
import NowPlaying from "./views/NowPlaying";
import { useUi } from "./stores/ui";
import Toast from "./components/Toast";
import ConfirmDialog from "./components/ConfirmDialog";
import CreditsDialog from "./components/CreditsDialog";
import UpdateDialog from "./components/UpdateDialog";
import { initUpdates } from "./stores/update";
import WhatsNewDialog from "./whatsNew/WhatsNewDialog";
import { initWhatsNew } from "./whatsNew/store";

export default function App() {
  // WebKit keeps painting content under an opaque overlay; hiding it makes Now Playing hover/scroll cheap.
  const covered = useUi((s) => s.nowPlayingCovering);
  useEffect(() => {
    useAuth.getState().init();
    initMediaKeys();
    void initTray();
    initDiscord();
    void initMpris();
    initHistory();
    initUpdates();
    initWhatsNew();
  }, []);
  return (
    <div className="flex h-full flex-col">
      <div className={`flex min-h-0 flex-1 ${covered ? "invisible" : ""}`}>
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
      <Toast />
    </div>
  );
}
