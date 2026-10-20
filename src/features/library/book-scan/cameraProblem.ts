export type CameraProblem = "no-camera" | "denied" | "in-use" | "unsupported" | "stalled" | "unknown";

export const CAMERA_PROBLEM_TEXT: Record<CameraProblem, string> = {
  "no-camera": "No camera was found. Connect a webcam and try again.",
  denied: "Camera access was blocked. Allow it for this app in your system's privacy settings, then try again.",
  "in-use": "The camera couldn't be opened. Another application may be using it.",
  unsupported: "Camera access isn't available in this environment.",
  stalled:
    "The camera opened but stopped sending video. On Linux this usually means GStreamer plugins are missing (see the README).",
  unknown: "The camera couldn't be started.",
};

function problemFor(errorName?: string): CameraProblem {
  switch (errorName) {
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "no-camera";
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "denied";
    case "TimeoutError":
      return "stalled";
    case "NotSupportedError":
      return "unsupported";
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return "in-use";
    default:
      return "unknown";
  }
}

/** Whatever the camera code threw -> a problem with a known message, plus a technical detail line. */
export function classify(e: unknown): { problem: CameraProblem; detail?: string } {
  const name = (e as { name?: string } | null)?.name;
  const detail = [name, e instanceof Error ? e.message : String(e)].filter(Boolean).join(": ");
  return { problem: problemFor(name), detail: detail || undefined };
}
