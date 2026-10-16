import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Box, IconButton, Switch, Tooltip, Typography } from "@mui/material";
import TuneIcon from "@mui/icons-material/Tune";
import { commands } from "@/lib/commands";
import type { PluginInfo } from "@/lib/types";
import { notify } from "@/notifications/notify";
import { PluginPath } from "./paths";

/**
 * Every installed book lookup plugin: turn each on or off, and open its config. A scanned barcode
 * is looked up with every plugin that's on and the answers are merged. Both choices are saved by
 * the backend and survive restarts.
 */
export function PluginList() {
  const navigate = useNavigate();
  const [plugins, setPlugins] = useState<PluginInfo[] | null>(null);

  const refresh = useCallback(async () => {
    try {
      setPlugins(await commands.plugins.listPlugins());
    } catch (e) {
      notify(`Couldn't load the plugins: ${String(e)}`, { severity: "error" });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const toggle = async (plugin: PluginInfo, enabled: boolean) => {
    // flip it right away; put the list back the way the backend has it if that fails
    setPlugins((list) => list?.map((p) => (p.id === plugin.id ? { ...p, enabled } : p)) ?? null);
    try {
      await commands.plugins.setPluginEnabled({ id: plugin.id, enabled });
    } catch (e) {
      notify(`Couldn't ${enabled ? "turn on" : "turn off"} ${plugin.name}: ${String(e)}`, { severity: "error" });
      refresh();
    }
  };

  if (!plugins) return null;
  const noneOn = plugins.length > 0 && plugins.every((p) => !p.enabled);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <Typography variant="body2" color="text.secondary">
        Scanning a barcode asks every plugin that's on and combines what they find.
      </Typography>

      {plugins.length === 0 && <Typography variant="body2">No plugins installed.</Typography>}
      {noneOn && <Alert severity="warning">Every plugin is off, so scanned books can't be looked up.</Alert>}

      {plugins.map((p) => (
        <Box key={p.id} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography>{p.name}</Typography>
            <Typography variant="caption" color="text.secondary">
              v{p.version}
              {p.builtin ? " · built in" : ""} · asks {p.http.length ? p.http.join(", ") : "no websites"}
            </Typography>
          </Box>
          <Tooltip title="Config">
            <IconButton
              aria-label={`Edit the config of ${p.name}`}
              onClick={() => navigate(PluginPath.config(p.id))}
            >
              <TuneIcon />
            </IconButton>
          </Tooltip>
          <Switch
            checked={p.enabled}
            onChange={(_, checked) => toggle(p, checked)}
            slotProps={{ input: { "aria-label": `Use ${p.name} for book lookup` } }}
          />
        </Box>
      ))}
    </Box>
  );
}
