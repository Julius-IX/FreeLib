import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { commands } from "@/lib/commands";
import type { PluginInfo } from "@/lib/types";
import { notify } from "@/notifications/notify";
import { isMobile } from "@/util/misc";

/**
 * A plugin error is a multi-line report ("[id] stage: message", then "hint: ..." and logs).
 * For a toast: the message, plus the hint if there is one. Log the whole thing for the details.
 */
export function reason(e: unknown): string {
  const lines = String(e).split("\n");
  const head = lines[0].replace(/^\[[^\]]*\]\s*\w+:\s*/, "");
  const hint = lines.find((l) => l.trim().startsWith("hint:"))?.trim().slice(5).trim();
  return hint ? `${head} (${hint})` : head;
}

/** The installed plugins. Shared by the top bar (install) and the list (toggle, remove). */
export function usePlugins() {
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

  return { plugins, setPlugins, refresh };
}

async function pickPluginFile(): Promise<string | null> {
  try {
    const picked = await open({
      multiple: false,
      directory: false,
      // Android's picker filters by mime type, and a .js file often isn't reported as JavaScript,
      // so it would be greyed out. The backend checks the file anyway.
      filters: isMobile() ? undefined : [{ name: "Plugin", extensions: ["js"] }],
    });
    return typeof picked === "string" ? picked : null;
  } catch (e) {
    notify(`Couldn't open the file picker: ${String(e)}`, { severity: "error" });
    return null;
  }
}

/**
 * Pick a .js file and install it. The backend checks it, copies it into the plugins folder,
 * loads it and turns it on. A plugin with the same id (a built-in one too) is replaced.
 */
export function useInstallPlugin(plugins: PluginInfo[] | null, refresh: () => Promise<void>) {
  const [busy, setBusy] = useState(false);

  const install = async () => {
    if (busy) return;
    const source = await pickPluginFile();
    if (!source) return;

    setBusy(true);
    try {
      const info = await commands.plugins.installPlugin({ source });
      const replaced = plugins?.some((p) => p.id === info.id);
      notify(`${replaced ? "Updated" : "Installed"} ${info.name}`, { severity: "success" });
      await refresh();
    } catch (e) {
      console.error("installPlugin failed", e);
      notify(`Couldn't install the plugin: ${reason(e)}`, { severity: "error", duration: 12000 });
    } finally {
      setBusy(false);
    }
  };

  return { install, busy };
}
