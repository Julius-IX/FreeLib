import { useRef, useState } from "react";
import { sleep } from "@/util/async";
import { useAlive } from "@/util/hooks";
import type { Facing } from "./cameraStream";
import { locate, type Rect } from "./geometry";
import { useOpenScanned } from "./useOpenScanned";
import { useWebcamScanner } from "./useWebcamScanner";

/** How long the viewfinder gets to fly to the code and lock on before moving on. */
const LOCK_ON_MS = 900;

export type Lookup = { status: "idle" } | { status: "busy" } | { status: "failed"; message: string };

/**
 * Everything the live (webview camera) scanners share: camera -> lock-on -> lookup -> Add Book.
 * `onFailed` is for a screen that wants to react to a failed lookup itself (mobile goes back).
 */
export function useScanFlow(facing: Facing, onFailed?: (message: string) => void) {
  const openScanned = useOpenScanned();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [lookup, setLookup] = useState<Lookup>({ status: "idle" });
  const [target, setTarget] = useState<Rect | null>(null);
  const [debug, setDebug] = useState(""); // dev builds only: live camera stats

  const alive = useAlive();

  const camera = useWebcamScanner(
    canvasRef,
    async (code, found) => {
      setTarget(canvasRef.current ? locate(found, canvasRef.current) : null);
      setLookup({ status: "busy" });
      await sleep(LOCK_ON_MS);
      if (!alive.current) return; // closed while it was locking on
      const message = await openScanned(code);
      if (message && alive.current) {
        setLookup({ status: "failed", message });
        onFailed?.(message);
      }
    },
    attempt,
    facing,
    import.meta.env.DEV ? setDebug : undefined
  );

  const retry = () => {
    setLookup({ status: "idle" });
    setTarget(null);
    setAttempt((a) => a + 1);
  };

  // The viewfinder shows once a code is read, and goes away again if its lookup fails.
  const locked = camera.phase === "done" && lookup.status !== "failed";

  return { canvasRef, camera, lookup, locked, target, retry, debug };
}
