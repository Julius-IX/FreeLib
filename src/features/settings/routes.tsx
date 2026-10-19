import { useEffect, useState } from "react";
import { RouteObject } from "react-router-dom";
import { getVersion } from "@tauri-apps/api/app";
import { Box, Typography, IconButton } from "@mui/material";
import { ThemeSwatches } from "@/themes/ThemePicker";
import { useAppTheme } from "@/themes/AppThemeProvider";
import { themeLabel } from "@/themes/themes";
import { libraryColumnsRange, useLibraryColumns } from "@/features/library/libraryColumns";
import { isLinux, REPO_URL } from "@/util/misc";
import { useX11OnWayland } from "./linuxSettings";
import { BackupSettings } from "./components/BackupSettings";
import { ImportSettings } from "./components/ImportSettings";
import { UpdateSettings } from "./components/UpdateSettings";
import { DebugSettings } from "./components/DebugSettings";
import { CategoryStylePicker } from "./components/CategoryStylePicker";
import { RatingStylePicker } from "./components/RatingStylePicker";
import { ShelvesSettings } from "./components/ShelvesSettings";
import { CATEGORY_STYLES, useCategoryStyle } from "@/features/library/categoryStyle";
import { RATING_STYLES, useRatingStyle, useRatingThemeColor, useShowRating } from "@/features/library/ratingStyle";
import {
  Preference, Section, SelectPreference, SliderPreference, SwitchPreference,
} from "./components/Preferences";
import GitHubIcon from "@mui/icons-material/GitHub";
import { openUrl } from "@tauri-apps/plugin-opener";

function VersionFooter() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(null));
  }, []);
  if (!version) return null;
  return (
    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 0.5, pt: 3 }}>
      <Typography variant="caption" color="text.secondary">
        Version {version}
      </Typography>
      <IconButton
        size="small"
        aria-label="Open the GitHub repository"
        onClick={() => openUrl(REPO_URL).catch((e) => console.error("couldn't open the link:", e))}
      >
        <GitHubIcon fontSize="inherit" />
      </IconButton>
    </Box>
  );
}

// One page for now. When it gets long, split a Section into its own screen (a sub-route).
function SettingsHome() {
  const { name, mode, setMode } = useAppTheme();
  const [columns, saveColumns] = useLibraryColumns();
  const { min, max } = libraryColumnsRange();
  const [x11OnWayland, setX11OnWayland] = useX11OnWayland();
  const [categoryStyle] = useCategoryStyle();
  const [showRating, setShowRating] = useShowRating();
  const [ratingStyle] = useRatingStyle();
  const [ratingThemeColor, setRatingThemeColor] = useRatingThemeColor();

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
          title="Theme mode"
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
        <Preference
          title="Category tag style"
          summary={CATEGORY_STYLES.find((s) => s.value === categoryStyle)?.label}
        >
          <CategoryStylePicker />
        </Preference>
        <SwitchPreference
          title="Show rating"
          summary="The row of icons under the blurb on a book's page."
          checked={showRating}
          onChange={setShowRating}
        />
        {showRating && (
          <>
            <Preference
              title="Rating style"
              summary={RATING_STYLES.find((s) => s.value === ratingStyle)?.label}
            >
              <RatingStylePicker />
            </Preference>
            <SwitchPreference
              title="Use theme color for ratings"
              summary="Draw every style in the theme's color instead of its own (gold stars, red hearts, ...)."
              checked={ratingThemeColor}
              onChange={setRatingThemeColor}
            />
          </>
        )}
      </Section>

      <ShelvesSettings />

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

      <UpdateSettings />

      <ImportSettings />

      <BackupSettings />

      <DebugSettings />

      <VersionFooter />
    </Box>
  );
}

export const settingsRoutes: RouteObject[] = [
  { index: true, element: <SettingsHome /> },
];
