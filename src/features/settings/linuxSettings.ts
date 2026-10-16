import { isBoolean, useSetting } from "@/lib/settings";

/**
 * Run through X11 (XWayland) in a Wayland session. On by default: Wayland-native WebKitGTK can
 * freeze the whole UI when the camera opens. The Rust side reads this before GTK starts (see
 * `linux_prefer_x11` in lib.rs), so a change only applies on the next launch, and the default
 * here has to match the one there.
 */
export function useX11OnWayland() {
  return useSetting<boolean>("linux.x11OnWayland", true, isBoolean);
}
