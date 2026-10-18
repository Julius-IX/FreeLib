import { useState } from "react";
import { Box, Chip } from "@mui/material";
import { RatingIcons } from "@/components/RatingIcons";
import { RATING_MAX, formatRating, formatRatingNumber } from "../rating";
import { useRatingStyle, useShowRating } from "../ratingStyle";
import { RatingDialog } from "./RatingDialog";
import { useBookRating } from "./useBookRating";

/**
 * The book's rating under its blurb: icons in the style picked in settings (tap them for a quick
 * rating), and the "7/10" next to them (tap it to type an exact one, like 7.5).
 * Always there, whether or not the book has a blurb, unless "Show rating" is off in settings.
 */
export function RatingRow({ bookId, large = false }: { bookId: number; large?: boolean }) {
  const [show] = useShowRating();
  const [style] = useRatingStyle();
  const { rating, save } = useBookRating(bookId, show);
  const [typing, setTyping] = useState(false);

  if (!show || rating === null) return null;

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
      <RatingIcons value={rating} style={style} size={large ? 32 : 28} onChange={save} />
      <Chip
        size="small"
        variant="outlined"
        clickable
        label={formatRating(rating)}
        aria-label={
          rating > 0
            ? `Rated ${formatRatingNumber(rating)} out of ${RATING_MAX}. Type an exact rating`
            : "Not rated. Type an exact rating"
        }
        onClick={() => setTyping(true)}
        sx={{
          minWidth: 60,
          fontVariantNumeric: "tabular-nums",
          color: rating > 0 ? "text.primary" : "text.secondary",
        }}
      />
      <RatingDialog open={typing} value={rating} onClose={() => setTyping(false)} onSave={save} />
    </Box>
  );
}
