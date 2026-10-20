import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Box, useTheme } from "@mui/material";
import BookCard, { bookCardSx } from "./BookCard";
import { Book } from "@/lib/types";
import { isMobile } from "@/util/misc";
import { useLibraryColumns } from "../libraryColumns";
import { markScrolling } from "../scrollGate";

/** Extra rows rendered above and below the viewport so fast scrolling doesn't reveal blanks. */
const OVERSCAN_ROWS = 2;
/** BookCard is a 2:3 card, so its height is 1.5x its width. */
const CARD_ASPECT = 1.5;

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
  const gap = parseFloat(theme.spacing(isOnMobile ? 1 : 2));

  const scrollerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [range, setRange] = useState({ start: 0, end: 0 });

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
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateRange]);

  // Items, columns or sizes changed (search, sort, shelf, scale): recompute the window.
  useLayoutEffect(updateRange, [updateRange]);

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
      }}
    >
      <Box
        ref={scrollerRef}
        onScroll={() => {
          markScrolling();
          updateRange();
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
    </Box>
  );
}
