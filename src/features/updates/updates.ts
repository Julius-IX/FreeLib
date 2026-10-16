import { useSyncExternalStore } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { getSetting, isBoolean, setSetting, useSetting } from "@/lib/settings";
import { notify } from "@/notifications/notify";
import { REPO_URL } from "@/util/misc";

/**
 * Update checking: asks GitHub for the repo's releases, and compares it with the running version.
 *
 * "Don't show again" is stored as the version it was ticked for. A newer release is a
 * different version, so it is shown again; the toggle resets itself with no extra bookkeeping.
 */

const CHECK_ON_STARTUP_KEY = "updates.checkOnStartup";
const DISMISSED_KEY = "updates.dismissedVersion";
const isString = (v: unknown): v is string => typeof v === "string";

const repoPath = new URL(REPO_URL).pathname.replace(/^\/|\/$/g, ""); // "owner/name"
const RELEASES_URL = `https://api.github.com/repos/${repoPath}/releases?per_page=100`;

export type Update = {
  /** Version without a leading "v", e.g. "1.2.0". */
  version: string;
  /** The version the app is running now. */
  current: string;
  /** The release page on GitHub. */
  url: string;
  name: string;
};

const parse = (v: string) =>
  v
    .trim()
    .replace(/^v/i, "")
    .split(/[-+]/)[0]
    .split(".")
    .map((n) => parseInt(n, 10) || 0);

/** > 0 when a is newer than b, < 0 when older, 0 when the same. */
export function compareVersions(a: string, b: string): number {
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

const clean = (v: string) => v.trim().replace(/^v/i, "");

type GithubRelease = {
  tag_name: string;
  name: string | null;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
};

async function fetchNewestRelease(): Promise<GithubRelease | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(RELEASES_URL, {
      signal: ctrl.signal,
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const all = (await res.json()) as GithubRelease[];
    // Highest version wins, whatever order GitHub lists them in.
    return (
      all
        .filter((r) => !r.draft && !r.prerelease && typeof r.tag_name === "string")
        .sort((a, b) => compareVersions(b.tag_name, a.tag_name))[0] ?? null
    );
  } finally {
    clearTimeout(timer);
  }
}

/** The newest release if it's newer than the running app, otherwise null. Throws if offline etc. */
export async function fetchAvailableUpdate(pretendCurrent?: string): Promise<Update | null> {
  const [release, current] = await Promise.all([
    fetchNewestRelease(),
    pretendCurrent ?? getVersion(),
  ]);
  if (!release || compareVersions(release.tag_name, current) <= 0) return null;
  return {
    version: clean(release.tag_name),
    current,
    url: release.html_url,
    name: release.name || release.tag_name,
  };
}

export const useCheckOnStartup = () =>
  useSetting<boolean>(CHECK_ON_STARTUP_KEY, true, isBoolean);

/** Whether "don't show again" is on for exactly this version. */
export const isDismissed = (version: string) => {
  const saved = getSetting<string>(DISMISSED_KEY, "", isString);
  return saved !== "" && compareVersions(saved, version) === 0;
};

export const setDismissed = (version: string, dismissed: boolean) =>
  setSetting(DISMISSED_KEY, dismissed ? version : "");

export const clearDismissed = () => setSetting(DISMISSED_KEY, "");

export const useIsDismissed = (version: string) => {
  const [saved] = useSetting<string>(DISMISSED_KEY, "", isString);
  return saved !== "" && compareVersions(saved, version) === 0;
};

type State = { update: Update | null; open: boolean; checking: boolean };
let state: State = { update: null, open: false, checking: false };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export const useUpdateState = () =>
  useSyncExternalStore(
    (cb) => (listeners.add(cb), () => void listeners.delete(cb)),
    () => state,
  );

export const closeUpdateDialog = () => set({ open: false });

/**
 * Runs a check. On startup it stays quiet (no dialog for a dismissed version, no error toast).
 * Manually it always reports back: the dialog, "up to date", or the error.
 */
export async function checkForUpdates(manual: boolean, pretendCurrent?: string) {
  if (state.checking) return;
  set({ checking: true });
  try {
    const update = await fetchAvailableUpdate(pretendCurrent);
    if (update) {
      set({ update, open: manual || !isDismissed(update.version) });
    } else if (manual) {
      notify("You're on the latest version", { severity: "success" });
    }
  } catch (e) {
    console.error("update check failed:", e);
    if (manual) notify("Couldn't check for updates. Are you online?", { severity: "error" });
  } finally {
    set({ checking: false });
  }
}

/** Startup check, honouring the setting. */
export const checkOnStartup = () => {
  if (getSetting(CHECK_ON_STARTUP_KEY, true, isBoolean)) void checkForUpdates(false);
};

/** Opens the dialog with a made-up newer version. No network. */
export const debugShowUpdate = () =>
  set({
    update: {
      version: "99.0.0",
      current: "0.0.0",
      url: REPO_URL + "/releases",
      name: "99.0.0 (fake)",
    },
    open: true,
  });

/** The real startup path, but pretending the app is on 0.0.0 so the newest release counts as news. */
export const debugStartupCheck = () => void checkForUpdates(false, "0.0.0");
