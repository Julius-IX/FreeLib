import { cancel, checkPermissions, requestPermissions, scan } from "@tauri-apps/plugin-barcode-scanner";

/**
 * Mobile only (the plugin has no desktop implementation). `scan()` resolves with the decoded
 * text, or rejects if the scan is cancelled.
 *
 * Used as the fallback when the webview can't open the camera itself (see ScanBook). It shows
 * the platform's own full-screen scanner.
 */
export type NativeScanOutcome =
  | { kind: "ok"; code: string }
  | { kind: "denied" } // camera permission refused
  | { kind: "none" }; // cancelled, or nothing readable came back

/** Makes sure the OS camera permission is granted (asks if needed). */
export async function ensureCameraPermission(): Promise<boolean> {
  try {
    let permission = await checkPermissions();
    if (permission !== "granted") permission = await requestPermissions();
    return permission === "granted";
  } catch {
    return false;
  }
}

export async function scanNative(): Promise<NativeScanOutcome> {
  try {
    if (!(await ensureCameraPermission())) return { kind: "denied" };

    const scanned = await scan({ windowed: false });
    const code = scanned.content?.trim();
    return code ? { kind: "ok", code } : { kind: "none" };
  } catch (e) {
    // The plugin rejects on cancel too, so this is the normal "user backed out" path.
    console.log("native scan ended without a result:", e);
    return { kind: "none" };
  }
}

/** Best effort: closes a scanner that's still open. */
export const cancelNativeScan = () => cancel().catch(() => { });
