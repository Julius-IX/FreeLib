import { useEffect, useState } from "react";
import { RouteObject } from "react-router-dom";
import { getVersion } from "@tauri-apps/api/app";
import { Box, Typography } from "@mui/material";
import { ThemeSwatches } from "@/themes/ThemePicker";
import { useAppTheme } from "@/themes/AppThemeProvider";
import { themeLabel } from "@/themes/themes";
import { libraryColumnsRange, useLibraryColumns } from "@/features/library/libraryColumns";
import { isLinux } from "@/util/misc";
import { useX11OnWayland } from "./linuxSettings";
import { BackupSettings } from "./components/BackupSettings";
import {
  Preference, Section, SelectPreference, SliderPreference, SwitchPreference,
} from "./components/Preferences";

function VersionFooter() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(null));
  }, []);
  if (!version) return null;
  return (
    <Typography variant="caption" color="text.secondary" sx={{ display: "block", textAlign: "center", pt: 3 }}>
      Version {version}
    </Typography>
  );
}

// One page for now. When it gets long, split a Section into its own screen (a sub-route).
function SettingsHome() {
  const { name, mode, setMode } = useAppTheme();
  const [columns, saveColumns] = useLibraryColumns();
  const { min, max } = libraryColumnsRange();
  const [x11OnWayland, setX11OnWayland] = useX11OnWayland();

  return (
    <Box sx={{ maxWidth: 720, mx: "auto", pb: 2 }}>
      <Box sx={{ px: 2, pt: 2, pb: 1, borderBottom: 1, borderColor: "divider" }}>
        <Typography variant="h5">Settings</Typography>
      </Box>

      <Section title="Appearance">
        <Preference title="Color theme" summary={themeLabel(name)}>
          <ThemeSwatches />
        </Preference>
        <SelectPreference
          title="Dark mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: "system", label: "Follow system" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </Section>

      <Section title="Library">
        <SliderPreference
          title="Columns"
          summary={(v) => `${v} ${v === 1 ? "book" : "books"} per row`}
          value={columns}
          min={min}
          max={max}
          onCommit={saveColumns}
        />
      </Section>

      {isLinux() && (
        <Section title="Linux">
          <SwitchPreference
            title="Use X11 on Wayland"
            summary="Runs through XWayland so the camera can't freeze the app. Only matters in a Wayland session. Restart the app to apply."
            checked={x11OnWayland}
            onChange={setX11OnWayland}
          />
        </Section>
      )}

      <BackupSettings />

      <VersionFooter />
    </Box>
  );
}

export const settingsRoutes: RouteObject[] = [
  { index: true, element: <SettingsHome /> },
];
