import { alpha, type Theme } from "@mui/material";
import type { SystemStyleObject } from "@mui/system";
import { Book, Category } from "@/lib/types";

// Small, pre-cropped 2:3 copy: the full-size placeholder is 1920x1080 and was being rescaled into
// every card on every frame. (The book page still uses the full-size one.)
import placeholderCover from "@/assets/placeholder-cover-small.png";
import { useCover } from "../useCover";
import { commands } from "@/lib/commands";
import { memo, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { useLibraryRevision } from "../libraryEvents";
import { isMobile } from "@/util/misc";
import { isScrolling, onScrollIdle } from "../scrollGate";

/**
 * A card is plain DOM + class names on purpose. The grid mounts a whole row of them every time a
 * row boundary is scrolled past. The styles live once on `bookCardSx` and cards carry class names.
 */

/** A touch held this long selects the card. */
const LONG_PRESS_MS = 500;
/** Finger travel (px) that turns a press into a scroll. */
const MOVE_SLOP = 10;

/** Styles for every `.bk-*` element below. Apply to the grid element that contains the cards. */
export const bookCardSx = (theme: Theme): SystemStyleObject<Theme> => ({
  "& .bk": {
    position: "relative",
    minWidth: 0,
    overflow: "hidden",
    borderRadius: `${theme.shape.borderRadius}px`,
    boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
    backgroundColor: theme.palette.action.hover,
    contain: "layout paint style", // a card repainting never invalidates its neighbours
  },
  "& .bk-btn": {
    position: "absolute",
    inset: 0,
    display: "block",
    width: "100%",
    height: "100%",
    margin: 0,
    padding: 0,
    border: 0,
    background: "none",
    color: "inherit",
    font: "inherit",
    textAlign: "left",
    cursor: "pointer",
    WebkitTapHighlightColor: "transparent",
  },
  // hover / keyboard-focus highlight, drawn by a pseudo-element so no extra node is mounted
  "& .bk-btn::after": {
    content: '""',
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    backgroundColor: "currentColor",
    opacity: 0,
  },
  "& .bk-btn:hover::after": { opacity: theme.palette.action.hoverOpacity },
  "& .bk-btn:focus-visible::after": { opacity: theme.palette.action.focusOpacity },
  "& .bk-btn:focus-visible": {
    outline: `2px solid ${theme.palette.primary.main}`,
    outlineOffset: -2,
  },
  // selection: a tint and frame over the whole card, and a round check mark drawn with borders
  // so that no icon component is mounted per card
  "& .bk-selected::after": {
    content: '""',
    position: "absolute",
    inset: 0,
    zIndex: 2,
    pointerEvents: "none",
    boxSizing: "border-box",
    border: `3px solid ${theme.palette.primary.main}`,
    borderRadius: "inherit",
    backgroundColor: alpha(theme.palette.primary.main, 0.22),
  },
  "& .bk-check": {
    position: "absolute",
    top: 22,
    right: 6,
    zIndex: 3,
    width: 22,
    height: 22,
    boxSizing: "border-box",
    borderRadius: "50%",
    border: "2px solid #fff",
    backgroundColor: "rgba(0,0,0,0.35)",
    pointerEvents: "none",
  },
  "& .bk-selected .bk-check": {
    backgroundColor: theme.palette.primary.main,
    borderColor: theme.palette.primary.main,
  },
  "& .bk-selected .bk-check::after": {
    content: '""',
    position: "absolute",
    left: 6,
    top: 2,
    width: 5,
    height: 10,
    border: "solid #fff",
    borderWidth: "0 2px 2px 0",
    transform: "rotate(45deg)",
  },
  "& .bk-img": {
    display: "block",
    width: "100%",
    height: "100%",
    objectFit: "cover",
  },
  "& .bk-fade": {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "45%",
    pointerEvents: "none",
    background:
      "linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.75) 35%, rgba(0,0,0,0) 100%)",
  },
  "& .bk-foot": { position: "absolute", left: 0, right: 0, bottom: 0, padding: theme.spacing(1) },
  "& .bk-title": {
    ...theme.typography.caption,
    color: "#fff",
    fontWeight: 600,
    lineHeight: 1.25,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  "& .bk-cats": {
    position: "absolute",
    top: 2,
    left: 6,
    right: 6,
    zIndex: 1,
    display: "flex",
    flexWrap: "nowrap",
    gap: "3px",
    pointerEvents: "none",
  },
  // taller than the bar so it's easy to hover, the container ignores the mouse, this doesn't
  "& .bk-cat": {
    flex: "0 1 28px",
    minWidth: 4,
    height: 16,
    display: "flex",
    alignItems: "center",
    pointerEvents: "auto",
  },
  "& .bk-cat-bar": {
    width: "100%",
    height: 8,
    borderRadius: "2.5px",
    // keeps pale colours visible on a light cover
    boxShadow: "0 0 0 1px rgba(0,0,0,0.35)",
  },
});

/** Categories per book, so scrolling back over a row doesn't re-query them. */
const categoryCache = new Map<number, { rev: number; categories: Category[] }>();

/**
 * Trello-style colour labels over the top of the cover: one small bar per category, colour only
 * (hover one for its name, the full chips are on the book's page). Always ONE line: the bars share
 * the width and shrink (down to a thin sliver) rather than wrapping, so a book with many
 * categories never covers more of the cover than one with a few.
 */
function CategoryChips({ bookId }: { bookId: number }) {
  // Re-read after a book or a category was saved (a recoloured category changes every card).
  const revision = useLibraryRevision();
  const cached = categoryCache.get(bookId);
  const [categories, setCategories] = useState<Category[]>(
    cached?.rev === revision ? cached.categories : [],
  );

  useEffect(() => {
    const hit = categoryCache.get(bookId);
    if (hit?.rev === revision) {
      setCategories(hit.categories);
      return;
    }
    let cancelled = false;

    const load = () => {
      if (cancelled) return;
      commands.db
        .getAllCategories({ bookId })
        .then((result) => {
          categoryCache.set(bookId, { rev: revision, categories: result });
          if (!cancelled) setCategories(result);
        })
        .catch((err) => {
          console.error("Failed to load categories", err);
        });
    };
    // not while the grid is moving, fetched once the scroll settles
    if (isScrolling()) onScrollIdle(load);
    else load();

    return () => {
      cancelled = true;
    };
  }, [bookId, revision]);

  if (categories.length === 0) return null;

  return (
    <div className="bk-cats" aria-label={`Categories: ${categories.map((c) => c.name).join(", ")}`}>
      {categories.map((c) => (
        <div key={c.categoryId} className="bk-cat" title={c.name}>
          <div className="bk-cat-bar" style={{ backgroundColor: c.color }} />
        </div>
      ))}
    </div>
  );
}

function BookCard({
  book,
  selecting,
  selected,
  onClick,
  onLongPress,
}: {
  book: Book;
  /** The grid is in selection mode, so every card shows a check mark. */
  selecting: boolean;
  selected: boolean;
  onClick?: (book: Book, e: MouseEvent) => void;
  /** A long touch or a right click. */
  onLongPress?: (book: Book) => void;
}) {
  // Desktop webviews rescale full-size covers on every scroll frame, so the grid gets thumbnails.
  const { url } = useCover(book.bookId, { thumb: !isMobile() });

  // A click follows the end of a long touch on some webviews, and must not count as a tap.
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const longPressed = useRef(false);

  const cancelPress = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };
  useEffect(() => cancelPress, []);

  // The mouse selects through right click and Ctrl-click, only touch and pen use the timer.
  const handlePointerDown = (e: PointerEvent) => {
    if (!onLongPress || e.pointerType === "mouse" || e.button !== 0) return;
    longPressed.current = false;
    press.current = {
      x: e.clientX,
      y: e.clientY,
      timer: setTimeout(() => {
        press.current = null;
        longPressed.current = true;
        onLongPress(book);
      }, LONG_PRESS_MS),
    };
  };

  const handlePointerMove = (e: PointerEvent) => {
    const p = press.current;
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_SLOP) cancelPress();
  };

  return (
    <div className={selected ? "bk bk-selected" : "bk"}>
      <button
        type="button"
        className="bk-btn"
        aria-pressed={selecting ? selected : undefined}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={cancelPress}
        onPointerCancel={cancelPress}
        onPointerLeave={cancelPress}
        onContextMenu={(e) => {
          // also what a long touch triggers on Android, where it would open the image menu
          e.preventDefault();
          if (!longPressed.current) onLongPress?.(book);
        }}
        onClick={(e) => {
          if (longPressed.current) {
            longPressed.current = false;
            return;
          }
          onClick?.(book, e);
        }}
      >
        <img className="bk-img" src={url ?? placeholderCover} alt={book.title} decoding="async" />
        <CategoryChips bookId={book.bookId} />
        {selecting && <div className="bk-check" aria-hidden />}
        <div className="bk-fade" />
        <div className="bk-foot">
          <span className="bk-title">{book.title}</span>
        </div>
      </button>
    </div>
  );
}

export default memo(BookCard);
