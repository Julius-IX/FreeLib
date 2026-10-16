import { getSetting, isBoolean, useSetting } from "@/lib/settings";

/** The Debug section of the settings page, and everything behind it, only exists in dev builds. */
export const isDebugBuild = import.meta.env.DEV;

const CAMERA_KEY = "debug.camera";

/** Camera scanner diagnostics: live stats under the viewfinder, console logging, fallback toasts. */
export const useCameraDebug = () => useSetting<boolean>(CAMERA_KEY, false, isBoolean);

/** For non-React code (the scanner hook). Always false in release builds. */
export const cameraDebugEnabled = () => isDebugBuild && getSetting(CAMERA_KEY, false, isBoolean);
