export type Rect = { left: number; top: number; width: number; height: number };

/** Where a decoded code sits in the camera frame, in the frame's own pixels. */
export type Found = {
  points: { x: number; y: number }[];
  frame: { w: number; h: number };
  /** QR-like (square) vs a 1D barcode (two points: the ends of the scanned line). */
  twoD: boolean;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/**
 * Turns the decoder's points into a rectangle in the on-screen canvas's pixels (CSS px), taking
 * the "cover" crop of the preview into account. Null if there are no points to go by.
 */
export function locate(found: Found, canvas: HTMLElement): Rect | null {
  if (found.points.length === 0) return null;
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  const s = Math.max(W / found.frame.w, H / found.frame.h);
  const offX = (W - found.frame.w * s) / 2;
  const offY = (H - found.frame.h * s) / 2;
  const xs = found.points.map((p) => p.x * s + offX);
  const ys = found.points.map((p) => p.y * s + offY);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  // The frame is a square around the points. For a QR the points are the finder patterns'
  // centres, which sit a few modules inside the edge. For a 1D code only the two ends of a scan
  // line are known, so the height is a guess: a barcode's bars are about as tall as it is wide.
  const grow = found.twoD && found.points.length >= 3 ? 1.32 : 1.15;
  const size = Math.max(maxX - minX, maxY - minY) * grow;
  const w = clamp(size, 120, W);
  const h = clamp(size, 120, H);
  return { left: clamp(cx - w / 2, 0, W - w), top: clamp(cy - h / 2, 0, H - h), width: w, height: h };
}
