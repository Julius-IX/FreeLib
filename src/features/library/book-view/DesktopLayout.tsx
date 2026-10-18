import { Box } from "@mui/material";
import type { Reading } from "@/lib/types";
import { Blurb } from "./Blurb";
import { BookCoverImage } from "./BookCoverImage";
import { BookInfo } from "./BookInfo";
import { RatingRow } from "./RatingRow";
import { ReadingHistory } from "./ReadingHistory";
import { CategoryRow } from "./CategoryRow";
import { TagRow } from "./TagRow";
import type { BookDetails } from "./types";

// Sticky cover sits just under the top bar (48px) with a little air.
const STICKY_TOP = 56;

export function DesktopLayout({
  details,
  readings,
  coverUrl,
}: {
  details: BookDetails;
  readings: Reading[];
  coverUrl: string;
}) {
  const { book, tags, categories } = details;
  return (
    <Box
      sx={{
        maxWidth: 1100,
        mx: "auto",
        p: 3,
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) minmax(220px, 380px)",
        gap: 4,
        alignItems: "start",
      }}
    >
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5, minWidth: 0 }}>
        <BookInfo details={details} large />
        {book.blurb && <Blurb text={book.blurb} />}
        <RatingRow bookId={book.bookId} large />
        <CategoryRow categories={categories} wrap />
        <TagRow tags={tags} wrap />
        <ReadingHistory readings={readings} />
      </Box>

      {/* stays in view while the left column scrolls; never taller than the window */}
      <Box sx={{ position: "sticky", top: STICKY_TOP }}>
        <BookCoverImage
          url={coverUrl}
          title={book.title}
          sx={{ width: `min(100%, calc((100dvh - ${STICKY_TOP + 32}px) * 2 / 3))`, ml: "auto" }}
        />
      </Box>
    </Box>
  );
}
