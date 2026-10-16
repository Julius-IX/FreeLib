import { Card, CardActionArea, Box, Typography } from "@mui/material";
import { Book } from "@/lib/types";

import placeholderCover from "@/assets/placeholder-cover.png";
import { useCover } from "../useCover";

/**
 * Saved cover or the placeholder. `useCover` hands back a cover that's already decoded (and cached
 * across remounts), so the swap from placeholder never paints an empty frame. The background
 * is a backstop so even a stray unpainted frame shows a neutral tile, not white.
 */
function BookCover({ isbn, title }: { isbn: string | null | undefined; title: string }) {
  const { url } = useCover(isbn);
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
