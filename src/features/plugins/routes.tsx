import { RouteObject } from "react-router-dom";
import { Box, Typography } from "@mui/material";
import { RouteHandle } from "@/app/tabs";
import { isDesktop, isMobile } from "@/util/misc";
import { PluginList } from "./PluginList";
import PluginConfig from "./PluginConfig";
import { PluginPath } from "./paths";

function PluginsHome() {
  return (
    <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2 }}>
      <Typography variant="h5">Plugins</Typography>
      <PluginList />
    </Box>
  );
}

export const pluginsRoutes: RouteObject[] = [
  { index: true, element: <PluginsHome /> },
  {
    path: PluginPath.Config,
    element: <PluginConfig />,
    handle: { hideNav: isMobile(), modal: isDesktop() } satisfies RouteHandle,
  },
];
