import { Card, CardActionArea, Box, Typography } from "@mui/material";
import { commands } from "@/lib/commands";
import { Book } from "@/lib/types";

import { useEffect, useState } from "react";
import placeholderCover from "@/assets/placeholder-cover.png";
import { useLocalImage } from "../screens/CoverPreview";

/** Path of the saved cover for this ISBN, or null if there isn't one. */
function useCoverPath(isbn: string | null | undefined) {
  const [path, setPath] = useState<string | null>(null);

  useEffect(() => {
    setPath(null);
    if (isbn == null) return;

    let cancelled = false;
    commands.covers
      .getCoverPath({ isbn })
      .then((p) => {
        if (!cancelled) setPath(p);
      })
      .catch(() => {
        if (!cancelled) setPath(null);
      });

    return () => {
      cancelled = true;
    };
  }, [isbn]);

  return path;
}

/**
 * Saved cover (read from disk as a blob, same as the preview) or the placeholder.
 * The placeholder is a normal bundled asset URL, so it's a plain <img>, not a file read.
 */
function BookCover({ isbn, title }: { isbn: string | null | undefined; title: string }) {
  const local = useLocalImage(useCoverPath(isbn));
  return (
    <Box
      component="img"
      src={local.url ?? placeholderCover}
      alt={title}
      sx={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }}
    />
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
        <BookCover isbn={book.isbn} title={book.title} />

        <Box
          sx={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            p: 1,
            pt: 4,
            background: "linear-gradient(transparent, rgba(0,0,0,0.85))",
          }}
        >
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
            }}
          >
            {book.title}
          </Typography>
        </Box>
      </CardActionArea>
    </Card>
  );
}

// TODO: use adjusted version of this when read history is implemented
// {/* Status badge */}
// <Box
//   sx={{
//     position: "absolute",
//     top: 6,
//     left: 6,
//     px: 0.75,
//     py: 0.25,
//     borderRadius: 1,
//     bgcolor: STATUS_COLORS[book.status],
//     color: "#fff",
//     fontSize: 10,
//     fontWeight: 600,
//     textTransform: "uppercase",
//     lineHeight: 1.4,
//   }}
// >
//   {book.status}
// </Box>
//
