import { RefObject, useEffect, useState } from "react";
import { useLatest } from "@/util/hooks";
import { withTimeout } from "@/util/async";
import type { Found } from "./geometry";
import { acquireCamera, dropCamera, releaseCamera, type Facing } from "./cameraStream";
import { classify, type CameraProblem } from "./cameraProblem";
import { createDecoder, createMotionSampler, createStallWatch, paint } from "./frameTools";
import { cameraDebugEnabled } from "@/features/settings/debugSettings";

/**
 * Reads codes from a camera with ZXing (pure JS). The browser `BarcodeDetector` API isn't in
 * every webview Tauri uses (WebKitGTK, WebView2 on Windows), so it can't be relied on.
 *
 * The preview is NOT a visible <video>: frames are copied onto a <canvas> by hand. WebKitGTK
 * can leave a <video> frozen on its first frame (compositing / GStreamer sink quirks), while
 * copying frames out of it still works. It also lets the last frame stay on screen when a code
 * is read, with the camera already released.
 */

export type CameraState =
  | { phase: "starting" }
  | { phase: "scanning" }
  | { phase: "done" } // a code was read, the camera is off
  | { phase: "error"; problem: CameraProblem; detail?: string };

const DECODE_EVERY_MS = 150;
const STALL_AFTER_MS = 8000; // no new video frame for this long = the camera pipeline is stuck
const PLAY_TIMEOUT_MS = 10000; // video.play() never settling = wedged pipeline
const WARM_UP_MAX_MS = 6000; // some USB cameras show one still frame for a few seconds first

/** Counters that only exist to explain what the camera was doing when it got stuck. */
type FrameStats = {
  presented: number; // frames the video element says it showed
  painted: number; // frames we copied onto the canvas
  changes: number; // times a tiny sample of the picture differed from the last one (noise counts)
};

function describeCamera(track: MediaStreamTrack | undefined, video: HTMLVideoElement, stats: FrameStats) {
  const st = track?.getSettings();
  return (
    `${track?.label || "camera"} ${st?.width}x${st?.height}@${st?.frameRate} | ` +
    `track=${track?.readyState}${track?.muted ? "/muted" : ""} video=${video.videoWidth}x${video.videoHeight} ` +
    `ready=${video.readyState} paused=${video.paused} t=${video.currentTime.toFixed(2)} ` +
    `presented=${stats.presented} painted=${stats.painted} changing=${stats.changes}`
  );
}

/** Counts the frames the video element presents. Returns a function that stops counting. */
function countPresented(video: HTMLVideoElement, stats: FrameStats) {
  let on = true;
  const count = () => {
    if (!on) return;
    stats.presented++;
    video.requestVideoFrameCallback?.(count);
  };
  video.requestVideoFrameCallback?.(count);
  return () => {
    on = false;
  };
}

/** An off-screen <video> is only a frame source. 1px and invisible, but in the DOM, because
 * some webviews won't play detached ones. */
function createFrameVideo() {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  Object.assign(video.style, { position: "fixed", left: "0", top: "0", width: "1px", height: "1px", opacity: "0", pointerEvents: "none" });
  document.body.appendChild(video);
  return video;
}

type LoopEvents = {
  onWarm: () => void; // the picture is really moving
  onStall: () => void;
  onCode: (text: string, found: Found) => void;
};

/**
 * Paints every frame and tries to decode one every DECODE_EVERY_MS, until a code is read or the
 * video stalls. Returns a function that stops the loop.
 */
function runScanLoop(canvasRef: RefObject<HTMLCanvasElement | null>, video: HTMLVideoElement, stats: FrameStats, on: LoopEvents) {
  const decode = createDecoder(video);
  const pictureMoved = createMotionSampler(video);
  const isStalled = createStallWatch(video, STALL_AFTER_MS);
  const startedAt = performance.now();
  let lastDecode = 0;
  let warm = false;
  let raf = 0;

  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);

    // Stuck pipeline: the picture stops changing. Say so instead of freezing silently.
    if (isStalled(now)) return on.onStall();

    const canvas = canvasRef.current;
    if (!canvas || video.readyState < 2 || !video.videoWidth) return;

    paint(canvas, video);
    stats.painted++;
    if (now - lastDecode < DECODE_EVERY_MS) return;
    lastDecode = now;

    if (pictureMoved()) stats.changes++;
    // Keep the spinner over that still first frame until the picture really moves.
    if (!warm && (stats.changes >= 3 || now - startedAt > WARM_UP_MAX_MS)) {
      warm = true;
      on.onWarm();
    }

    const hit = decode();
    if (hit) on.onCode(hit.text, hit.found);
  };

  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

/**
 * Starts the camera, paints it onto `canvasRef`, and calls `onCode` once with the first code it
 * reads and where that code is in the frame. The camera is released at that point; the canvas
 * keeps the last frame. Bump `attempt` to start over, e.g. from a "Try again" button.
 */
export function useWebcamScanner(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  onCode: (code: string, found: Found) => void,
  attempt: number,
  facing: Facing,
  onDebug?: (line: string) => void
): CameraState {
  const [state, setState] = useState<CameraState>({ phase: "starting" });
  const onCodeRef = useLatest(onCode);
  const onDebugRef = useLatest(onDebug);

  useEffect(() => {
    let cancelled = false;
    let held = false; // we hold a reference on the shared camera stream
    const video = createFrameVideo();
    const cleanups: (() => void)[] = [];

    const release = () => {
      cleanups.splice(0).forEach((fn) => fn());
      video.srcObject = null;
      // The stream itself is shared and parked by cameraStream, not stopped here.
      if (held) {
        held = false;
        releaseCamera();
      }
    };

    const fail = (problem: CameraProblem, detail?: string) => {
      dropCamera(); // a failed or wedged stream must not be handed to the next attempt
      release();
      setState({ phase: "error", problem, detail });
    };

    setState({ phase: "starting" });
    // Deferred a tick so StrictMode's throwaway first run never opens the camera.
    const timer = setTimeout(async () => {
      try {
        held = true;
        const stream = await acquireCamera(facing);
        if (cancelled) return; // the cleanup below has already released everything
        video.srcObject = stream;
        await withTimeout(video.play(), PLAY_TIMEOUT_MS, "Starting video");
        if (cancelled) return;

        const track = stream.getVideoTracks()[0];
        const stats: FrameStats = { presented: 0, painted: 0, changes: 0 };
        const describe = () => describeCamera(track, video, stats);

        cleanups.push(countPresented(video, stats));
        if (cameraDebugEnabled()) {
          const dbg = setInterval(() => {
            const line = describe();
            console.log("[scan]", line);
            onDebugRef.current?.(line);
          }, 500);
          cleanups.push(() => clearInterval(dbg));
        }

        cleanups.push(
          runScanLoop(canvasRef, video, stats, {
            onWarm: () => setState({ phase: "scanning" }),
            onStall: () => {
              const detail = describe();
              console.warn("[scan] stalled:", detail);
              fail("stalled", detail);
            },
            onCode: (text, found) => {
              release(); // the canvas keeps the last frame
              setState({ phase: "done" });
              onCodeRef.current(text, found);
            },
          })
        );
      } catch (e) {
        if (cancelled) return;
        const { problem, detail } = classify(e);
        fail(problem, detail);
      }
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      release();
      video.remove();
    };
  }, [canvasRef, attempt, facing]);

  return state;
}
