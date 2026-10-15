/**
 * One shared camera stream for the scanner.
 *
 * WebKitGTK opens the camera through xdg-desktop-portal + PipeWire, and that handshake is slow
 * (the "warm-up") and, when the portal hiccups, blocks the whole app until it times out. Opening
 * and closing the camera on every scan multiplies both problems. So the stream is opened once,
 * handed out with a refcount, and only really stopped after it has been unused for a while.
 * Concurrent requests share one pending open, so two can never hit the portal at once.
 */

import { namedError, withTimeout } from "@/util/async";

const IDLE_STOP_MS = 15_000; // camera light stays on this long after leaving the scanner
export const OPEN_TIMEOUT_MS = 12_000;

export type Facing = "user" | "environment";
type Shared = { facing: Facing; promise: Promise<MediaStream>; stream?: MediaStream };

let current: Shared | null = null;
let holders = 0;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function stopStream(s?: MediaStream) {
  s?.getTracks().forEach((t) => t.stop());
}

function isLive(s?: MediaStream) {
  const tracks = s?.getVideoTracks() ?? [];
  return tracks.length > 0 && tracks.every((t) => t.readyState === "live");
}

function open(facing: Facing): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) return Promise.reject(namedError("NotSupportedError", "getUserMedia unavailable"));
  // No enumerateDevices() first: on WebKitGTK that probes the camera backend an extra time, and
  // getUserMedia already reports NotFoundError when there is no camera.
  // All `ideal`, so nothing can fail the request (a desktop's only camera isn't "user"-facing
  // everywhere). Without a size the webview picks a low default, often 640x480.
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    audio: false,
  });
}

/** Starts opening a stream and makes it the shared one. Rejects if it fails or gets dropped meanwhile. */
function openShared(facing: Facing): Shared {
  const entry: Shared = {
    facing,
    promise: withTimeout(open(facing), OPEN_TIMEOUT_MS, "Opening the camera").then(
      (stream) => {
        if (current !== entry) {
          stopStream(stream); // dropped (or timed out) while opening: don't leak it
          throw namedError("AbortError", "camera request was superseded");
        }
        entry.stream = stream;
        return stream;
      },
      (e) => {
        if (current === entry) current = null;
        throw e;
      }
    ),
  };
  return entry;
}

/** Gets the shared stream (opening it if needed). Every call must be paired with releaseCamera(). */
export async function acquireCamera(facing: Facing): Promise<MediaStream> {
  holders++;
  clearTimeout(idleTimer);

  const unusable = current && (current.facing !== facing || (current.stream && !isLive(current.stream)));
  if (unusable) dropCamera();

  current ??= openShared(facing);
  return current.promise;
}

/** Done with the stream. It keeps running for a moment in case the scanner is reopened. */
export function releaseCamera() {
  holders = Math.max(0, holders - 1);
  if (holders > 0) return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(dropCamera, IDLE_STOP_MS);
}

/** Stops the stream now and forgets it, so the next acquire opens a fresh one (use after errors). */
export function dropCamera() {
  clearTimeout(idleTimer);
  const old = current;
  current = null;
  stopStream(old?.stream);
}
