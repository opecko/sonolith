import { useEffect } from "react";
import Switch from "../components/Switch";
import { SettingCard, SettingRow } from "../views/settings/kit";
import { useLocalApi } from "./store";

/** Settings → Connected apps: the local API switch (api/SPEC.md 3.4). */
export default function ConnectedAppsSettings() {
  const status = useLocalApi((s) => s.status);
  const setEnabled = useLocalApi((s) => s.setEnabled);
  useEffect(() => void useLocalApi.getState().refresh().catch(() => {}), []);
  const enabled = !!status?.enabled;
  return (
    <SettingCard>
      <SettingRow
        id="apiEnabled"
        title="Allow other apps to connect"
        detail={
          <>
            Apps on this computer can ask to see and control what's playing, your queue and your library. You decide what each one may do.
            {enabled && status?.error && <span className="mt-1 block select-text text-[var(--c-error)]">Could not start: {status.error}</span>}
          </>
        }
      >
        <Switch on={enabled} onChange={(v) => void setEnabled(v)} label="Allow other apps to connect" disabled={!status} />
      </SettingRow>
    </SettingCard>
  );
}
