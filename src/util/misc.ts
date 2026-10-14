import { platform } from "@tauri-apps/plugin-os";

export const isMobile = () => {
  return platform() === "android" || platform() === "ios";
}

export const isDesktop = () => {
  return platform() === "linux" || platform() === "macos" || platform() === "windows";
}
