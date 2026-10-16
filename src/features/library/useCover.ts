import { useEffect, useReducer } from "react";
import { readFile } from "@tauri-apps/plugin-fs";
import placeholderCover from "@/assets/placeholder-cover.png";
import { commands } from "@/lib/commands";
import { isValidIsbn, normIsbn } from "./book-form/inputs";
import { useCoverRevision } from "./libraryEvents";
import { MIME } from "./screens/CoverPreview";

/**
 * Cover cache, so remounting the grid (route change, modal close, ...) doesn't re-read every cover.
 *
 * Without it every BookCard starts empty on mount, shows the placeholder, then does an IPC call
 * and a file read before it has a URL, and its <img> is blank until that blob decodes.
 */

type PathEntry = { rev: number; path: string | null };
type ImageEntry = { path: string; rev: number; url: string };

const paths = new Map<string, PathEntry>(); // normalized ISBN -> saved cover path (or none)
const images = new Map<string, ImageEntry>(); // normalized ISBN -> decoded blob URL
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

// A just-superseded blob may still be on screen for a moment, so revoke it a little later.
const revokeLater = (url: string) => setTimeout(() => URL.revokeObjectURL(url), 2000);

function lookupPath(id: string, rev: number) {
  return dedupe(`path:${id}:${rev}`, async () => {
    try {
      const path = await commands.covers.getCoverPath({ isbn: id });
      const cur = paths.get(id);
      if (cur && cur.rev > rev) return; // a newer lookup already landed
      paths.set(id, { rev, path });
      if (path === null) {
        // cover was removed: drop the old blob so the card falls back to the placeholder
        const old = images.get(id);
        if (old) {
          images.delete(id);
          revokeLater(old.url);
        }
      }
    } catch (e) {
      // Not cached, so the next mount tries again.
      console.error(`getCoverPath(${id}) failed`, e);
    }
  });
}

function loadImage(id: string, path: string, rev: number) {
  return dedupe(`img:${id}:${rev}:${path}`, async () => {
    try {
      const bytes = await readFile(path);
      const ext = path.split(".").pop()?.toLowerCase() ?? "";
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: MIME[ext] ?? "" }));

      // Decode off-screen so the <img> that gets this URL paints immediately.
      const probe = new Image();
      probe.src = url;
      await probe.decode().catch(() => { });

      const prev = images.get(id);
      if (prev && prev.rev > rev) {
        URL.revokeObjectURL(url); // lost a race against a newer cover
        return;
      }
      images.set(id, { path, rev, url });
      if (prev) revokeLater(prev.url);
    } catch (e) {
      console.error(`couldn't read cover ${path}`, e);
    }
  });
}

/**
 * `path`: the saved cover file (null if none or not looked up yet).
 * `url`: a ready-to-render blob URL, or null -> show the placeholder.
 * While a replaced cover reloads, the previous one stays up rather than blinking to the placeholder.
 */
export function useCover(isbn: string | null | undefined) {
  const rev = useCoverRevision(isbn);
  const id = isbn != null && isValidIsbn(isbn) ? normIsbn(isbn) : null;
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

  const img = id ? images.get(id) : undefined;
  const fresh = !!img && !!path && img.path === path && img.rev === rev;

  useEffect(() => {
    if (!id || !path || fresh) return;
    let live = true;
    loadImage(id, path, rev).then(() => live && rerender());
    return () => {
      live = false;
    };
  }, [id, path, rev, fresh]);

  return { path: path ?? null, url: path === null ? null : (img?.url ?? null) };
}
