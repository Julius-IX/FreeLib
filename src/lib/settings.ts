import { useSyncExternalStore } from "react";
import { commands } from "./commands";
import { notify } from "@/notifications/notify";

/**
 * Saved UI state (theme, toggles, dropdowns, ...), kept in `<app data>/settings.json`.
 * Loaded once before the first render (see main.tsx), so reading is synchronous.
 *
 *   const [sidebarW, setSidebarW] = useSetting("sidebarW", 240, isNumber);
 */
export const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";

let cache: Record<string, unknown> = {};
const listeners = new Set<() => void>();

export async function loadSettings() {
  try {
    cache = await commands.settings.getSettings();
  } catch (e) {
    console.error("couldn't load the settings, using defaults:", e);
  }
}

/**
 * `valid` guards against a saved value that isn't usable (hand-edited file, a setting whose
 * options changed): the fallback is returned instead.
 */
export function getSetting<T>(key: string, fallback: T, valid?: (v: unknown) => v is T): T {
  const v = cache[key];
  if (v === undefined) return fallback;
  return !valid || valid(v) ? (v as T) : fallback;
}

export function setSetting<T>(key: string, value: T) {
  cache = { ...cache, [key]: value };
  listeners.forEach((l) => l());
  commands.settings
    .setSetting({ key, value })
    .catch((e) => notify(`Couldn't save "${key}": ${String(e)}`, { severity: "error" }));
}

/** Like `useState`, but saved, and shared by everything that uses the same key. */
export function useSetting<T>(key: string, fallback: T, valid?: (v: unknown) => v is T) {
  const value = useSyncExternalStore(
    (cb) => (listeners.add(cb), () => void listeners.delete(cb)),
    () => getSetting(key, fallback, valid),
  );
  return [value, (v: T) => setSetting(key, v)] as const;
}
