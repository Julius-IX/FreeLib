import { useCallback, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { alpha, Box, useTheme } from "@mui/material";
import BookCard, { bookCardSx } from "./BookCard";
import { Book } from "@/lib/types";
import { isMobile } from "@/util/misc";
import { useLibraryColumns } from "../libraryColumns";
import { markScrolling } from "../scrollGate";
import { useLibrary } from "../LibraryContext";
import { libraryViewState } from "../libraryViewState";

/** Extra rows rendered above and below the viewport so fast scrolling doesn't reveal blanks. */
const OVERSCAN_ROWS = 2;
/** BookCard is a 2:3 card, so its height is 1.5x its width. */
const CARD_ASPECT = 1.5;
/** Pointer distance (px) from the right edge that counts as "hovering the scrollbar". */
const EDGE_HOT_ZONE = 16;
/** Smallest thumb height (px), so it stays grabbable in very long libraries. */
const MIN_THUMB = 36;

/**
 * Windowed grid: only the rows in (or near) the viewport are mounted. Everything above and below
 * is replaced by padding of the same height, so the scrollbar and scroll position behave exactly
 * as if every card were rendered. Row height is derived from the width (cards are a fixed 2:3), so
 * no per-row measuring is needed.
 */
export default function CardGrid({
  items,
  onOpen,
}: {
  items: Book[];
  onOpen?: (book: Book) => void;
}) {
  const isOnMobile = isMobile();
  const [columns] = useLibraryColumns();
  const theme = useTheme();
  const { loading } = useLibrary();
  const gap = parseFloat(theme.spacing(isOnMobile ? 1 : 2));

  const scrollerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [range, setRange] = useState({ start: 0, end: 0 });

  // Overlay scrollbar: invisible until the mouse goes to the right edge, so the native look
  // (no bar while wheel-scrolling) is kept. The thumb is positioned imperatively so scrolling
  // doesn't re-render the grid.
  const thumbRef = useRef<HTMLDivElement>(null);
  const [barVisible, setBarVisible] = useState(false);
  const dragRef = useRef<{ startY: number; startTop: number } | null>(null);
  const wheelPos = useRef<{ x: number; y: number } | null>(null);

  const updateThumb = useCallback(() => {
    const el = scrollerRef.current;
    const thumb = thumbRef.current;
    if (!el || !thumb) return;
    const overflow = el.scrollHeight - el.clientHeight;
    if (overflow <= 0) {
      thumb.style.display = "none";
      return;
    }
    const height = Math.max(MIN_THUMB, (el.clientHeight * el.clientHeight) / el.scrollHeight);
    const top = (el.scrollTop / overflow) * (el.clientHeight - height);
    thumb.style.display = "block";
    thumb.style.height = `${height}px`;
    thumb.style.transform = `translateY(${top}px)`;
  }, []);

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" || dragRef.current) return;
    const wheel = wheelPos.current;
    if (wheel) {
      // Right after a wheel scroll the bar stays hidden until the mouse really moves.
      if (Math.hypot(e.clientX - wheel.x, e.clientY - wheel.y) < 4) return;
      wheelPos.current = null;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setBarVisible(e.clientX >= rect.right - EDGE_HOT_ZONE);
  };

  const handleThumbDown = (e: PointerEvent<HTMLDivElement>) => {
    const el = scrollerRef.current;
    if (!el) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startY: e.clientY, startTop: el.scrollTop };
  };

  const handleThumbMove = (e: PointerEvent<HTMLDivElement>) => {
    const el = scrollerRef.current;
    const thumb = thumbRef.current;
    const drag = dragRef.current;
    if (!el || !thumb || !drag) return;
    const travel = el.clientHeight - thumb.offsetHeight;
    if (travel <= 0) return;
    el.scrollTop =
      drag.startTop + ((e.clientY - drag.startY) * (el.scrollHeight - el.clientHeight)) / travel;
  };

  const handleThumbUp = (e: PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    // The track starts at the grid's right edge (it lives in the page padding).
    const rect = e.currentTarget.parentElement?.getBoundingClientRect();
    if (rect && e.clientX < rect.left - EDGE_HOT_ZONE) setBarVisible(false);
  };

  // Keeps BookCard's props stable so memoised cards don't re-render when the window moves.
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const handleOpen = useCallback((book: Book) => onOpenRef.current?.(book), []);

  const rowCount = Math.ceil(items.length / columns);
  const cardWidth = (width - gap * (columns - 1)) / columns;
  const stride = cardWidth > 0 ? cardWidth * CARD_ASPECT + gap : 0; // one row incl. its gap

  const updateRange = useCallback(() => {
    const el = scrollerRef.current;
    if (!el || stride <= 0) return;
    const first = Math.floor(el.scrollTop / stride);
    const last = Math.ceil((el.scrollTop + el.clientHeight) / stride);
    const start = Math.max(0, first - OVERSCAN_ROWS);
    const end = Math.min(rowCount, last + OVERSCAN_ROWS);
    setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, [stride, rowCount]);

  // Track the scroller's size (window resize, rotation, side panels opening, ...).
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const measure = () => {
      setWidth(el.clientWidth);
      updateRange();
      updateThumb();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateRange, updateThumb]);

  // Items, columns or sizes changed (search, sort, shelf, scale): recompute the window.
  useLayoutEffect(() => {
    updateRange();
    updateThumb();
  }, [updateRange, updateThumb, rowCount]);

  // The grid is remounted when a book is opened, and its tab loses the scroll offset while hidden
  // (display: none). The saved offset is put back once the grid is measured and loaded again.
  const restore = useRef(true);
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (stride <= 0) {
      restore.current = true;
      return;
    }
    if (loading || !restore.current) return;
    restore.current = false;
    if (libraryViewState.scrollTop > 0) {
      el.scrollTop = libraryViewState.scrollTop;
      updateRange();
      updateThumb();
    }
  }, [loading, stride, rowCount, updateRange, updateThumb]);

  const startIndex = range.start * columns;
  const endIndex = Math.min(items.length, range.end * columns);
  const visible = items.slice(startIndex, endIndex);

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        position: "relative",
      }}
      onPointerMove={isOnMobile ? undefined : handlePointerMove}
      onPointerLeave={() => {
        if (!dragRef.current) setBarVisible(false);
        wheelPos.current = null;
      }}
      onWheel={(e) => {
        wheelPos.current = { x: e.clientX, y: e.clientY };
        if (!dragRef.current) setBarVisible(false);
      }}
    >
      <Box
        ref={scrollerRef}
        onScroll={(e) => {
          if (stride > 0 && !restore.current) libraryViewState.scrollTop = e.currentTarget.scrollTop;
          markScrolling();
          updateRange();
          updateThumb();
        }}
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overflowX: "hidden",
          overflowAnchor: "none",
          scrollbarWidth: "none", // Firefox
          "&::-webkit-scrollbar": { display: "none" }, // WebKit webviews
        }}
      >
        {/*
          Fixed-height spacer: the scroll height never changes while scrolling, so the browser's
          scroll anchoring has nothing to "correct". The mounted rows sit inside it at their real
          offset, with explicit row heights so they line up exactly with the maths above.
        */}
        <Box
          sx={{
            position: "relative",
            height: `${Math.max(0, rowCount * stride - gap)}px`,
          }}
        >
          <Box
            sx={[
              bookCardSx,
              {
                position: "absolute",
                top: `${range.start * stride}px`,
                left: 0,
                right: 0,
                display: "grid",
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                gridAutoRows: `${cardWidth * CARD_ASPECT}px`,
                gap: `${gap}px`,
              },
            ]}
          >
            {visible.map((book) => (
              <BookCard key={book.bookId} book={book} onClick={handleOpen} />
            ))}
          </Box>
        </Box>
      </Box>

      {!isOnMobile && (
        // Track: sits in the page padding right of the grid so the thumb hugs the window edge
        // instead of covering the cards.
        <Box
          onWheel={(e) => {
            if (scrollerRef.current) scrollerRef.current.scrollTop += e.deltaY;
          }}
          sx={{ position: "absolute", top: 0, bottom: 0, left: "100%", width: gap }}
        >
          <Box
            ref={thumbRef}
            onPointerDown={handleThumbDown}
            onPointerMove={handleThumbMove}
            onPointerUp={handleThumbUp}
            onPointerCancel={handleThumbUp}
            sx={{
              position: "absolute",
              top: 0,
              right: 3,
              width: 8,
              borderRadius: 4,
              display: "none",
              touchAction: "none",
              bgcolor: alpha(theme.palette.text.primary, 0.35),
              "&:hover, &:active": { bgcolor: alpha(theme.palette.text.primary, 0.55) },
              opacity: barVisible ? 1 : 0,
              pointerEvents: barVisible ? "auto" : "none",
              transition: "opacity 150ms",
            }}
          />
        </Box>
      )}
    </Box>
  );
}
