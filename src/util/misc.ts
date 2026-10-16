import { platform } from "@tauri-apps/plugin-os";

export const isMobile = () => {
  return platform() === "android" || platform() === "ios";
}

export const isDesktop = () => {
  return platform() === "linux" || platform() === "macos" || platform() === "windows";
}

/** Wraps fn so it runs on the first call only; every later call returns that first result. */
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
