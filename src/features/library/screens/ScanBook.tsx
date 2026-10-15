import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Box, Button, CircularProgress, DialogActions, DialogContent, DialogTitle, IconButton, Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CloseIcon from "@mui/icons-material/Close";
import OptionalModal from "@/modal/OptionalModal";
import { isMobile } from "@/util/misc";
import { useAlive, useOnce } from "@/util/hooks";
import { notify } from "@/notifications/notify";
import { cancelNativeScan, ensureCameraPermission, scanNative } from "../book-scan/nativeScan";
import { ScanOverlay } from "../book-scan/ScanOverlay";
import { useOpenScanned } from "../book-scan/useOpenScanned";
import { useScanFlow } from "../book-scan/useScanFlow";
import { CAMERA_PROBLEM_TEXT } from "../book-scan/cameraProblem";

const STARTING_TEXT = "Starting camera…";
const LOOKING_UP_TEXT = "Looking up book…";
const TEXT_SHADOW = "0 1px 4px rgba(0,0,0,0.8)";

const fullScreen = { position: "fixed", inset: 0, zIndex: 1300, bgcolor: "common.black" } as const;
const fillParent = { position: "absolute", inset: 0, width: "100%", height: "100%" } as const;

type NotifyOptions = Parameters<typeof notify>[1];
const ERROR_TOAST: NotifyOptions = { severity: "error", duration: 5000 };

/** Every way a scan can fail ends the same: tell the user, then leave the scan screen. */
function useBackWith() {
  const navigate = useNavigate();
  return (message: string, options: NotifyOptions = ERROR_TOAST) => {
    notify(message, options);
    navigate(-1);
  };
}

/**
 * Both platforms scan from a live camera view inside the webview, so the viewfinder can fly to
 * wherever the code is. Desktop: a modal with the laptop's camera. Mobile: a full-screen page
 * with the back camera, which falls back to the platform's own scanner if the webview can't open
 * the camera. A successful scan is looked up and replaced by Add Book, prefilled.
 */
export default function ScanBook() {
  return isMobile() ? <MobileScan /> : <DesktopScan />;
}

function MobileScan() {
  const [stage, setStage] = useState<"permission" | "live" | "native">("permission");

  // The webview's own camera request only works once Android / iOS has granted the app camera
  // permission, so ask through the plugin first. If that's refused, the native path reports it.
  useOnce(() => {
    ensureCameraPermission().then((ok) => setStage(ok ? "live" : "native"));
  });

  if (stage === "permission") return <Box sx={fullScreen} />;
  if (stage === "native") return <NativeScan />;
  return (
    <LiveMobileScan
      onUnavailable={(reason) => {
        console.warn("live camera unavailable, using the system scanner:", reason);
        if (import.meta.env.DEV) notify(`Live camera unavailable (${reason}), using the system scanner`, { severity: "warning", duration: 8000 });
        setStage("native");
      }}
    />
  );
}

function LiveMobileScan({ onUnavailable }: { onUnavailable: (reason: string) => void }) {
  const navigate = useNavigate();
  const backWith = useBackWith();
  const { canvasRef, camera, lookup, locked, target } = useScanFlow("environment", backWith);

  // Webview camera not available (permission never requested, no getUserMedia...): hand over to
  // the plugin, which asks for permission properly and has its own scanner UI.
  useEffect(() => {
    if (camera.phase === "error") onUnavailable(`${camera.problem}${camera.detail ? `: ${camera.detail}` : ""}`);
  }, [camera.phase]);

  return (
    <Box sx={{ ...fullScreen, overflow: "hidden" }}>
      <canvas ref={canvasRef} style={fillParent} />
      <ScanOverlay locked={locked} target={target} />

      <IconButton
        aria-label="Cancel"
        onClick={() => navigate(-1)}
        sx={{
          position: "absolute",
          top: "calc(env(safe-area-inset-top) + 8px)",
          left: 8,
          color: "common.white",
          bgcolor: "rgba(0,0,0,0.4)",
        }}
      >
        <ArrowBackIcon />
      </IconButton>

      <Typography
        sx={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: "calc(env(safe-area-inset-bottom) + 48px)",
          textAlign: "center",
          px: 2,
          color: "common.white",
          textShadow: TEXT_SHADOW,
        }}
      >
        {camera.phase === "starting"
          ? STARTING_TEXT
          : lookup.status === "busy"
            ? LOOKING_UP_TEXT
            : "Point the camera at a barcode or QR code"}
      </Typography>
    </Box>
  );
}

/** Fallback: the platform's own scanner. It opens full screen and returns the text (or nothing). */
function NativeScan() {
  const navigate = useNavigate();
  const backWith = useBackWith();
  const openScanned = useOpenScanned();
  const [lookingUp, setLookingUp] = useState(false);

  // `alive` drops the result if the screen was really left while the scanner was open.
  const alive = useAlive();
  useEffect(
    () => () => {
      // Left with the scanner still open (e.g. hardware back): close it. Deferred a tick so
      // StrictMode's fake unmount/remount (which flips `alive` straight back) doesn't cancel it.
      setTimeout(() => {
        if (!alive.current) cancelNativeScan();
      }, 0);
    },
    []
  );

  // StrictMode runs effects twice in dev; the scanner must only be opened once.
  useOnce(() => {
    (async () => {
      const outcome = await scanNative();
      if (!alive.current) return;
      if (outcome.kind === "denied") return backWith("Camera permission is needed to scan. Allow it in the app's settings.");
      if (outcome.kind === "none") return backWith("Nothing was scanned", { severity: "info" });

      setLookingUp(true);
      const error = await openScanned(outcome.code);
      if (error && alive.current) backWith(error);
    })();
  });

  return (
    <Box sx={{ p: 2, height: "100%", display: "flex", flexDirection: "column", boxSizing: "border-box" }}>
      <Box>
        <IconButton aria-label="Back" onClick={() => navigate(-1)}>
          <ArrowBackIcon />
        </IconButton>
      </Box>
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}>
        <CircularProgress />
        <Typography color="text.secondary">{lookingUp ? LOOKING_UP_TEXT : "Opening scanner…"}</Typography>
      </Box>
    </Box>
  );
}

function StartingOverlay() {
  return (
    <Box
      sx={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 1.5,
        color: "common.white",
      }}
    >
      <CircularProgress color="inherit" />
      <Typography variant="body2">{STARTING_TEXT}</Typography>
    </Box>
  );
}

function LookingUpLabel() {
  return (
    <Typography
      variant="body2"
      sx={{ position: "absolute", left: 0, right: 0, bottom: 12, textAlign: "center", color: "common.white", textShadow: TEXT_SHADOW }}
    >
      {LOOKING_UP_TEXT}
    </Typography>
  );
}

function DesktopScan() {
  const navigate = useNavigate();
  const { canvasRef, camera, lookup, locked, target, retry, debug } = useScanFlow("user");
  const close = () => navigate(-1);

  const cameraError = camera.phase === "error" ? camera : null;
  const failed = cameraError !== null || lookup.status === "failed";
  const starting = camera.phase === "starting";

  return (
    <OptionalModal fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pr: 1 }}>
        Scan book
        <IconButton aria-label="Close" onClick={close}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Box
          sx={{
            position: "relative",
            width: "100%",
            aspectRatio: "4 / 3",
            bgcolor: "common.black",
            borderRadius: 1,
            overflow: "hidden",
          }}
        >
          {/* Frames are painted onto this by hand; see useWebcamScanner for why it isn't a <video>.
              Not mirrored: this is for aiming at a barcode, not a selfie. */}
          <canvas
            ref={canvasRef}
            style={{ ...fillParent, visibility: cameraError ? "hidden" : "visible" }}
          />
          {!cameraError && <ScanOverlay locked={locked} target={target} />}
          {starting && <StartingOverlay />}
          {lookup.status === "busy" && <LookingUpLabel />}
        </Box>

        {cameraError && (
          <Alert severity="error">
            {CAMERA_PROBLEM_TEXT[cameraError.problem]}
            {cameraError.problem !== "no-camera" && cameraError.detail ? ` (${cameraError.detail})` : ""}
          </Alert>
        )}
        {lookup.status === "failed" && <Alert severity="error">{lookup.message}</Alert>}
        {!failed && (
          <Typography variant="body2" color="text.secondary">
            Hold the book's barcode or a QR code steady in front of the camera.
          </Typography>
        )}
        {import.meta.env.DEV && debug && (
          <Typography variant="caption" color="text.disabled" sx={{ fontFamily: "monospace", wordBreak: "break-all" }}>
            {debug}
          </Typography>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={close}>Close</Button>
        {failed && (
          <Button variant="contained" onClick={retry}>
            Try again
          </Button>
        )}
      </DialogActions>
    </OptionalModal>
  );
}
