import { Preference, Section, SwitchPreference } from "./Preferences";
import { notify } from "@/notifications/notify";
import {
  clearDismissed, debugShowUpdate, debugStartupCheck,
} from "@/features/updates/updates";
import { isDebugBuild, useCameraDebug } from "../debugSettings";

/** Dev builds only. Renders nothing in a release build. */
export function DebugSettings() {
  const [cameraDebug, setCameraDebug] = useCameraDebug();
  if (!isDebugBuild) return null;

  return (
    <Section title="Debug">
      <SwitchPreference
        title="Camera scanner debug info"
        summary="Live camera stats under the viewfinder, console logging, and a toast when the live camera falls back to the system scanner."
        checked={cameraDebug}
        onChange={setCameraDebug}
      />
      <Preference
        title="Show update dialog"
        summary="Opens the dialog with a fake version 99.0.0, no network."
        onClick={debugShowUpdate}
      />
      <Preference
        title="Run startup update check as if on 0.0.0"
        summary="Real request, same rules as startup: stays hidden if “don't show again” is on for the newest release."
        onClick={debugStartupCheck}
      />
      <Preference
        title="Reset “don't show again”"
        summary="Forgets which version was dismissed."
        onClick={() => {
          clearDismissed();
          notify("Cleared the dismissed update version", { severity: "info" });
        }}
      />
    </Section>
  );
}
