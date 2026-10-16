import { RouteObject } from "react-router-dom";
import { Box, Typography } from "@mui/material";
import { ThemePicker } from "@/themes/ThemePicker";
import LibraryColumnsField from "@/features/library/components/LibraryColumnsField";

function SettingsHome() {
  return (
    <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2 }}>
      <Typography variant="h5">Settings</Typography>
      <ThemePicker />
      <LibraryColumnsField />
    </Box>
  );
}

export const settingsRoutes: RouteObject[] = [
  { index: true, element: <SettingsHome /> },
];
