import { Box } from "@mui/material";
import type { Reading } from "@/lib/types";
import { Blurb } from "./Blurb";
import { BookCoverImage } from "./BookCoverImage";
import { BookInfo } from "./BookInfo";
import { ReadingHistory } from "./ReadingHistory";
import { TagRow } from "./TagRow";
import type { BookDetails } from "./types";

/** Tachiyomi style: cover (col 1) next to the details (col 2), then blurb, tags, read history. */
export function MobileLayout({
  details,
  readings,
  coverUrl,
}: {
  details: BookDetails;
  readings: Reading[];
  coverUrl: string;
}) {
  const { book, tags } = details;
  return (
    <Box>
      <Box sx={{ position: "relative", overflow: "hidden" }}>
        {/* blurred cover as backdrop, faded into the page background */}
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            inset: 0,
            backgroundImage: `url("${coverUrl}")`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            filter: "blur(24px)",
            transform: "scale(1.3)",
            opacity: 0.25,
          }}
        />
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            inset: 0,
            background: (t) => `linear-gradient(transparent 40%, ${t.palette.background.default})`,
          }}
        />
        <Box sx={{ position: "relative", display: "flex", gap: 2, p: 2 }}>
          <BookCoverImage
            url={coverUrl}
            title={book.title}
            sx={{ width: "clamp(96px, 30vw, 160px)", flexShrink: 0, alignSelf: "flex-start" }}
          />
          <BookInfo details={details} />
        </Box>
      </Box>

      <Box sx={{ display: "flex", flexDirection: "column", gap: 1, px: 2 }}>
        {book.blurb && <Blurb text={book.blurb} />}
        <TagRow tags={tags} />
        <Box sx={{ pt: 1 }}>
          <ReadingHistory readings={readings} />
        </Box>
      </Box>
    </Box>
  );
}
