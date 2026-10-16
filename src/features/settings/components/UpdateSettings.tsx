import { Preference, Section, SwitchPreference } from "./Preferences";
import { checkForUpdates, useCheckOnStartup, useUpdateState } from "@/features/updates/updates";

export function UpdateSettings() {
  const [onStartup, setOnStartup] = useCheckOnStartup();
  const { checking } = useUpdateState();

  return (
    <Section title="Updates">
      <SwitchPreference
        title="Check for updates on startup"
        summary="Asks GitHub for the latest release when the app opens."
        checked={onStartup}
        onChange={setOnStartup}
      />
      <Preference
        title="Check for updates"
        summary={checking ? "Checking…" : "Look for a newer version now"}
        onClick={checking ? undefined : () => checkForUpdates(true)}
      />
    </Section>
  );
}
