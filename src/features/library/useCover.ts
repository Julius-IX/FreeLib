import { useEffect, useReducer } from "react";
import { readFile } from "@tauri-apps/plugin-fs";
import placeholderCover from "@/assets/placeholder-cover.png";
import { commands } from "@/lib/commands";
import { useCoverRevision } from "./libraryEvents";
import { MIME } from "./screens/CoverPreview";
import { isScrolling, onScrollIdle } from "./scrollGate";

/**
 * Cover cache, so remounting the grid (route change, modal close, ...) doesn't re-read every cover.
 *
 * Without it every BookCard starts empty on mount, shows the placeholder, then does an IPC call
 * and a file read before it has a URL, and its <img> is blank until that blob decodes.
 */

type PathEntry = { rev: number; path: string | null };
type ImageEntry = { path: string; rev: number; url: string };

const paths = new Map<number, PathEntry>(); // book id -> saved cover path (or none)
const images = new Map<number, ImageEntry>(); // book id -> decoded blob URL (full size)
const thumbs = new Map<number, ImageEntry>(); // book id -> small blob URL, for the grid
const pending = new Map<string, Promise<void>>();

// Keep the bundled placeholder decoded and in memory so it never flashes either.
const placeholderImg = new Image();
placeholderImg.src = placeholderCover;
placeholderImg.decode().catch(() => { });

/** Joins concurrent requests for the same thing (many cards, StrictMode's double effect). */
function dedupe(key: string, run: () => Promise<void>) {
  let p = pending.get(key);
  if (!p) {
    p = run().finally(() => pending.delete(key));
    pending.set(key, p);
  }
  return p;
}

/**
 * Cover loads run through a small queue, since a fast scroll used to start hundreds of heavy
 * read + decode jobs in parallel. The newest request runs first (the row on screen) and a job
 * whose card has already unmounted is dropped.
 */
const MAX_CONCURRENT_LOADS = 3;
const wanted = new Map<number, number>(); // book id -> cards currently showing it
const queue: { id: number; run: () => Promise<void>; done: () => void }[] = [];
let running = 0;

function pump() {
  if (isScrolling()) {
    onScrollIdle(pump); // nothing heavy while the grid is moving
    return;
  }
  while (running < MAX_CONCURRENT_LOADS && queue.length > 0) {
    const job = queue.pop()!;
    if (!wanted.get(job.id)) {
      job.done();
      continue;
    }
    running++;
    job.run().finally(() => {
      running--;
      job.done();
      pump();
    });
  }
}

function enqueue(id: number, run: () => Promise<void>) {
  return new Promise<void>((done) => {
    queue.push({ id, run, done });
    pump();
  });
}

// A just-superseded blob may still be on screen for a moment, so revoke it a little later.
const revokeLater = (url: string) => setTimeout(() => URL.revokeObjectURL(url), 2000);

function lookupPath(id: number, rev: number) {
  return dedupe(`path:${id}:${rev}`, async () => {
    try {
      const path = await commands.covers.getCoverPath({ bookId: id });
      const cur = paths.get(id);
      if (cur && cur.rev > rev) return; // a newer lookup already landed
      paths.set(id, { rev, path });
      if (path === null) {
        // cover was removed: drop the old blob so the card falls back to the placeholder
        for (const store of [images, thumbs]) {
          const old = store.get(id);
          if (old) {
            store.delete(id);
            revokeLater(old.url);
          }
        }
      }
    } catch (e) {
      // Not cached, so the next mount tries again.
      console.error(`getCoverPath(${id}) failed`, e);
    }
  });
}

/** Width of a grid thumbnail. Plenty for a card, a fraction of the pixels of a full-size cover. */
const THUMB_WIDTH = 480;

/**
 * Downscales once, off the paint path. Software-rendered webviews (WebKitGTK on Linux) otherwise
 * rescale the full-size cover on every frame while scrolling. Falls back to the original on error.
 */
async function makeThumb(blob: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, THUMB_WIDTH / bitmap.width);
    if (scale === 1) {
      bitmap.close();
      return blob; // already small
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return blob;
    }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const out = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.88));
    return out ?? blob;
  } catch {
    return blob;
  }
}

function loadImage(id: number, path: string, rev: number, thumb: boolean) {
  const store = thumb ? thumbs : images;
  return dedupe(`${thumb ? "thumb" : "img"}:${id}:${rev}:${path}`, () => enqueue(id, async () => {
    try {
      const bytes = await readFile(path);
      const ext = path.split(".").pop()?.toLowerCase() ?? "";
      let blob = new Blob([new Uint8Array(bytes)], { type: MIME[ext] ?? "" });
      if (thumb) blob = await makeThumb(blob);
      const url = URL.createObjectURL(blob);

      // Decode off-screen so the <img> that gets this URL paints immediately.
      const probe = new Image();
      probe.src = url;
      await probe.decode().catch(() => { });

      const prev = store.get(id);
      if (prev && prev.rev > rev) {
        URL.revokeObjectURL(url); // lost a race against a newer cover
        return;
      }
      store.set(id, { path, rev, url });
      if (prev) revokeLater(prev.url);
    } catch (e) {
      console.error(`couldn't read cover ${path}`, e);
    }
  }));
}

/**
 * `path`: the saved cover file (null if none or not looked up yet).
 * `url`: a ready-to-render blob URL, or null -> show the placeholder.
 * While a replaced cover reloads, the previous one stays up rather than blinking to the placeholder.
 * `thumb`: a small downscaled copy (for the grid) instead of the full-size cover.
 */
export function useCover(bookId: number | null | undefined, { thumb = false } = {}) {
  const rev = useCoverRevision(bookId);
  const id = bookId ?? null;
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  // undefined = not looked up yet, null = looked up, no cover
  const p = id ? paths.get(id) : undefined;
  const path = p && p.rev === rev ? p.path : undefined;

  useEffect(() => {
    if (!id || path !== undefined) return;
    let live = true;
    lookupPath(id, rev).then(() => live && rerender());
    return () => {
      live = false;
    };
  }, [id, rev, path]);

  const img = id ? (thumb ? thumbs : images).get(id) : undefined;
  const fresh = !!img && !!path && img.path === path && img.rev === rev;

  useEffect(() => {
    if (!id || !path || fresh) return;
    let live = true;
    wanted.set(id, (wanted.get(id) ?? 0) + 1);
    loadImage(id, path, rev, thumb).then(() => live && rerender());
    return () => {
      live = false;
      const n = (wanted.get(id) ?? 1) - 1;
      if (n > 0) wanted.set(id, n);
      else wanted.delete(id);
    };
  }, [id, path, rev, fresh, thumb]);

  return { path: path ?? null, url: path === null ? null : (img?.url ?? null) };
}
