import { platform } from "@tauri-apps/plugin-os";

/** The GitHub repo of the app. Also what update checks look at for new releases. */
export const REPO_URL = "https://github.com/Julius-IX/FreeLib";

export const isMobile = () => {
  return platform() === "android" || platform() === "ios";
}

/** Desktop Linux only: Android reports its own platform name. */
export const isLinux = () => platform() === "linux";

export const isDesktop = () => {
  return platform() === "linux" || platform() === "macos" || platform() === "windows";
}

/** Wraps fn so it runs on the first call only. Every later call returns that first result. */
export const once = <T>(fn: () => T): (() => T) => {
  let done = false;
  let value: T;
  return () => {
    if (!done) {
      value = fn();
      done = true;
    }
    return value;
  };
};
