import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType, type Result } from "@zxing/library";
import type { Found } from "./geometry";

// Books carry EAN-13 (ISBN) barcodes. QR and a few others are accepted too.
const hints = new Map<DecodeHintType, unknown>([
  [
    DecodeHintType.POSSIBLE_FORMATS,
    [
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.CODE_128,
      BarcodeFormat.QR_CODE,
    ],
  ],
  [DecodeHintType.TRY_HARDER, true],
]);

// Don't shrink webcam frames: on a soft picture, 1D barcodes stop reading at 960px wide even
// though the same frame reads at full size.
const MAX_DECODE_WIDTH = 1280;
const SHARPEN_AMOUNT = 2;

// Reused between frames: allocating ~8MB of floats several times a second invites GC stalls.
let lum = new Float32Array(0);
let rowBlur = new Float32Array(0);

/**
 * Unsharp mask on the grayscale picture, in place. Webcam barcodes are usually soft, this firms
 * up bars. The blur is a 3x3 box, done as a pass along the rows then a pass down the columns.
 */
function sharpen(canvas: HTMLCanvasElement) {
  const { width: w, height: h } = canvas;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, w, h);
  const px = img.data; // clamps to 0-255 on write
  const n = w * h;
  if (lum.length !== n) {
    lum = new Float32Array(n);
    rowBlur = new Float32Array(n);
  }

  for (let o = 0; o < n; o++) lum[o] = 0.299 * px[o * 4] + 0.587 * px[o * 4 + 1] + 0.114 * px[o * 4 + 2];
  // Runs across row ends too, but the 1px border is skipped below so those values are never read.
  for (let o = 1; o < n - 1; o++) rowBlur[o] = (lum[o - 1] + lum[o] + lum[o + 1]) / 3;

  for (let o = w + 1; o < n - w - 1; o++) {
    const x = o % w;
    if (x === 0 || x === w - 1) continue; // the border keeps its original pixels
    const blur = (rowBlur[o - w] + rowBlur[o] + rowBlur[o + w]) / 3;
    const v = lum[o] + SHARPEN_AMOUNT * (lum[o] - blur);
    px[o * 4] = px[o * 4 + 1] = px[o * 4 + 2] = v;
    px[o * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/** Draws the video onto the canvas, cropped to fill it like `object-fit: cover`. */
export function paint(canvas: HTMLCanvasElement, video: HTMLVideoElement) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.round(canvas.clientWidth * dpr);
  const H = Math.round(canvas.clientHeight * dpr);
  if (W === 0 || H === 0) return;
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
  }
  const s = Math.max(W / video.videoWidth, H / video.videoHeight);
  const dw = video.videoWidth * s;
  const dh = video.videoHeight * s;
  canvas.getContext("2d")?.drawImage(video, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

/** Returns a function that tries to read a code from the video's current frame (null if none). */
export function createDecoder(video: HTMLVideoElement) {
  const reader = new BrowserMultiFormatReader(hints as Map<DecodeHintType, never>);
  const grab = document.createElement("canvas");
  let tries = 0;

  return (): { text: string; found: Found } | null => {
    const k = Math.min(1, MAX_DECODE_WIDTH / video.videoWidth);
    grab.width = Math.round(video.videoWidth * k);
    grab.height = Math.round(video.videoHeight * k);
    grab.getContext("2d", { willReadFrequently: true })?.drawImage(video, 0, 0, grab.width, grab.height);

    // Alternate plain and sharpened versions of the frame.
    if (tries++ % 2 === 1) sharpen(grab);

    let result: Result;
    try {
      result = reader.decodeFromCanvas(grab);
    } catch {
      return null; // nothing readable in this frame
    }
    return {
      text: result.getText(),
      found: {
        points: result.getResultPoints().map((p) => ({ x: p.getX() / k, y: p.getY() / k })),
        frame: { w: video.videoWidth, h: video.videoHeight },
        twoD: result.getBarcodeFormat() === BarcodeFormat.QR_CODE,
      },
    };
  };
}

/**
 * Returns a function that says whether a tiny sample of the picture differs from the previous call
 * (noise counts). Used to tell a live picture from a single still frame.
 */
export function createMotionSampler(video: HTMLVideoElement) {
  const SIZE = 16;
  const tiny = document.createElement("canvas");
  tiny.width = tiny.height = SIZE;
  const ctx = tiny.getContext("2d", { willReadFrequently: true });
  let lastSum = -1;

  return (): boolean => {
    if (!ctx) return false;
    ctx.drawImage(video, 0, 0, SIZE, SIZE);
    const sum = ctx.getImageData(0, 0, SIZE, SIZE).data.reduce((a, b) => a + b, 0);
    const changed = sum !== lastSum;
    lastSum = sum;
    return changed;
  };
}

/** Returns a function that says whether the video's clock has been stuck for `afterMs`. */
export function createStallWatch(video: HTMLVideoElement, afterMs: number) {
  let lastTime = -1;
  let lastMove = performance.now();

  return (now: number): boolean => {
    if (video.currentTime !== lastTime) {
      lastTime = video.currentTime;
      lastMove = now;
      return false;
    }
    return now - lastMove > afterMs;
  };
}
