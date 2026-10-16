import { RouteObject } from "react-router-dom";
import { Box } from "@mui/material";
import { RouteHandle } from "@/app/tabs";
import { isDesktop, isMobile } from "@/util/misc";
import { PluginList } from "./PluginList";
import PluginsTopBar from "./PluginsTopBar";
import { useInstallPlugin, usePlugins } from "./usePlugins";
import PluginConfig from "./PluginConfig";
import { PluginPath } from "./paths";

function PluginsHome() {
  const { plugins, setPlugins, refresh } = usePlugins();
  const { install, busy } = useInstallPlugin(plugins, refresh);

  return (
    <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2 }}>
      <PluginsTopBar onInstall={install} busy={busy} />
      <PluginList plugins={plugins} setPlugins={setPlugins} refresh={refresh} />
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
