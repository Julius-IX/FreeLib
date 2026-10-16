import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Alert } from "@mui/material";
import NotesPage from "@/components/NotesPage";
import { commands } from "@/lib/commands";
import type { PluginInfo } from "@/lib/types";

const GENERIC_EXAMPLE = '{\n  "setting": "value"\n}';

/** A config is a JSON object. Blank is fine too: it means "no config". */
function validateConfig(text: string): string | null {
  if (text.trim() === "") return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    return e instanceof Error ? e.message : "that isn't valid JSON";
  }
  const isObject = value !== null && typeof value === "object" && !Array.isArray(value);
  return isObject ? null : 'it has to be a JSON object, like { "apiKey": "…" }';
}

/**
 * A plugin's config, written in the same screen the book notes use. It's JSON (for Google Books:
 * `{ "apiKey": "…" }`) saved by the backend as `<app data>/plugins/<id>.config.json`. Text that
 * isn't valid JSON yet is left unsaved, so a half-typed config never replaces a working one.
 */
export default function PluginConfig() {
  const { pluginId } = useParams<{ pluginId: string }>();
  const [plugin, setPlugin] = useState<PluginInfo | null>(null);

  useEffect(() => {
    let stale = false;
    commands.plugins
      .listPlugins()
      .then((list) => !stale && setPlugin(list.find((p) => p.id === pluginId) ?? null))
      .catch(() => { }); // only the name and hints come from here; the editor reports its own load errors
    return () => {
      stale = true;
    };
  }, [pluginId]);

  const load = useCallback(() => commands.plugins.getPluginConfig({ id: pluginId! }), [pluginId]);
  const save = useCallback(
    (config: string) => commands.plugins.setPluginConfig({ id: pluginId!, config }),
    [pluginId]
  );

  return (
    <NotesPage
      title="Config"
      subtitle={plugin?.name ?? pluginId}
      what="config"
      loadFailedText="Couldn't load this plugin's config."
      load={pluginId ? load : null}
      save={save}
      validate={validateConfig}
      plain
      placeholder={plugin?.configExample ?? GENERIC_EXAMPLE}
      notice={
        plugin?.ignoreConfig && (
          <Alert severity="info">{plugin.name} doesn't use a config, so anything written here is ignored.</Alert>
        )
      }
    />
  );
}
