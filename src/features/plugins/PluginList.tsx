import { Dispatch, SetStateAction, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Box, IconButton, Switch, Tooltip, Typography } from "@mui/material";
import TuneIcon from "@mui/icons-material/Tune";
import DeleteIcon from "@mui/icons-material/Delete";
import { commands } from "@/lib/commands";
import type { PluginInfo } from "@/lib/types";
import { notify } from "@/notifications/notify";
import { PluginPath } from "./paths";
import { RemovePluginDialog } from "./RemovePluginDialog";
import { reason } from "./usePlugins";

/**
 * Every installed book lookup plugin: turn each on or off, open its config, remove the ones that
 * aren't built in. A scanned barcode is looked up with every plugin that's on and the answers are
 * merged. All of it is saved by the backend and survives restarts.
 */
export function PluginList({
  plugins,
  setPlugins,
  refresh,
}: {
  plugins: PluginInfo[] | null;
  setPlugins: Dispatch<SetStateAction<PluginInfo[] | null>>;
  refresh: () => Promise<void>;
}) {
  const navigate = useNavigate();
  // `removing` stays set while the dialog fades out, so its text doesn't blank mid-animation
  const [removing, setRemoving] = useState<PluginInfo | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [removeBusy, setRemoveBusy] = useState(false);

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

  const askRemove = (plugin: PluginInfo) => {
    setRemoving(plugin);
    setConfirmOpen(true);
  };

  const confirmRemove = async () => {
    if (!removing) return;
    setRemoveBusy(true);
    try {
      await commands.plugins.removePlugin({ id: removing.id });
      notify(`Removed ${removing.name}`);
      setConfirmOpen(false);
    } catch (e) {
      console.error("removePlugin failed", e);
      notify(`Couldn't remove ${removing.name}: ${reason(e)}`, { severity: "error" });
    } finally {
      setRemoveBusy(false);
      refresh(); // also brings a built-in back if the removed plugin had replaced it
    }
  };

  if (!plugins) return null;
  const noneOn = plugins.length > 0 && plugins.every((p) => !p.enabled);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
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
          {p.builtin ? (
            // same width as the remove button, so the switches line up
            <Box sx={{ width: 40, flexShrink: 0 }} />
          ) : (
            <Tooltip title="Remove">
              <IconButton aria-label={`Remove ${p.name}`} onClick={() => askRemove(p)}>
                <DeleteIcon />
              </IconButton>
            </Tooltip>
          )}
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

      <RemovePluginDialog
        open={confirmOpen}
        name={removing?.name ?? ""}
        busy={removeBusy}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={confirmRemove}
      />
    </Box>
  );
}
