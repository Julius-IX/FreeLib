import { Card, CardActionArea, Box, Tooltip, Typography } from "@mui/material";
import { Book, Category } from "@/lib/types";

import placeholderCover from "@/assets/placeholder-cover.png";
import { useCover } from "../useCover";
import { commands } from "@/lib/commands";
import { useEffect, useState } from "react";
import { useLibraryRevision } from "../libraryEvents";

/**
 * Saved cover or the placeholder. `useCover` hands back a cover that's already decoded (and cached
 * across remounts), so the swap from placeholder never paints an empty frame. The background
 * is a backstop so even a stray unpainted frame shows a neutral tile, not white.
 */
function BookCover({ bookId, title }: { bookId: number; title: string }) {
  const { url } = useCover(bookId);
  return (
    <Box sx={{ width: "100%", height: "100%", bgcolor: "action.hover" }}>
      <Box
        component="img"
        src={url ?? placeholderCover}
        alt={title}
        decoding="sync"
        sx={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }}
      />
    </Box>
  );
}

/**
 * Trello-style colour labels over the top of the cover: one small bar per category, colour only
 * (hover one for its name; the full chips are on the book's page). Always ONE line: the bars share the width and shrink
 * (down to a thin sliver) rather than wrapping, so a book with many categories never covers
 * more of the cover than one with a few.
 */
function CategoryChips({ bookId }: { bookId: number }) {
  const [categories, setCategories] = useState<Category[]>([]);
  // Re-read after a book or a category was saved (a recoloured category changes every card).
  const revision = useLibraryRevision();

  useEffect(() => {
    let cancelled = false;

    commands.db
      .getAllCategories({ bookId })
      .then((result) => {
        if (!cancelled) setCategories(result);
      })
      .catch((err) => {
        console.error("Failed to load categories", err);
      });

    return () => {
      cancelled = true;
    };
  }, [bookId, revision]);

  if (categories.length === 0) return null;

  return (
    <Box
      aria-label={`Categories: ${categories.map((c) => c.name).join(", ")}`}
      sx={{
        position: "absolute",
        top: 2,
        left: 6,
        right: 6,
        zIndex: 1,
        display: "flex",
        flexWrap: "nowrap",
        gap: "3px",
        pointerEvents: "none",
      }}
    >
      {categories.map((c) => (
        <Tooltip key={c.categoryId} title={c.name} placement="bottom" enterDelay={100} arrow>
          {/* taller than the bar so it's easy to hover; the container ignores the mouse, this doesn't */}
          <Box
            sx={{
              flex: "0 1 28px",
              minWidth: 4,
              height: 16,
              display: "flex",
              alignItems: "center",
              pointerEvents: "auto",
            }}
          >
            <Box
              sx={{
                width: "100%",
                height: 8,
                borderRadius: "2.5px",
                bgcolor: c.color,
                // keeps pale colours visible on a light cover
                boxShadow: "0 0 0 1px rgba(0,0,0,0.35)",
              }}
            />
          </Box>
        </Tooltip>
      ))}
    </Box>
  );
}

export default function BookCard({
  book,
  onClick,
}: {
  book: Book;
  onClick?: (book: Book) => void;
}) {
  return (
    <Card sx={{ aspectRatio: "2 / 3", position: "relative", minWidth: 0 }}>
      <CardActionArea
        onClick={() => onClick?.(book)}
        sx={{ position: "absolute", inset: 0 }}
      >
        <BookCover bookId={book.bookId} title={book.title} />
        <CategoryChips bookId={book.bookId} />

        <Box
          sx={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: "45%",
            pointerEvents: "none",
            background:
              "linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.75) 35%, rgba(0,0,0,0) 100%)",
          }}
        />

        <Box sx={{ position: "absolute", left: 0, right: 0, bottom: 0, p: 1 }}>
          <Typography
            variant="caption"
            sx={{
              color: "#fff",
              fontWeight: 600,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              lineHeight: 1.25,
              textShadow: "0 1px 3px rgba(0,0,0,0.6)",
            }}
          >
            {book.title}
          </Typography>
        </Box>
      </CardActionArea>
    </Card>
  );
}
