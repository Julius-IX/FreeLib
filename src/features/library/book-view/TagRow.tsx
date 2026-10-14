import { Box, Chip } from "@mui/material";
import type { Tag } from "@/lib/types";

/** Chips in one scrollable line (touch), or wrapped (`wrap`, for the wider desktop column). */
export function TagRow({ tags, wrap = false }: { tags: Tag[]; wrap?: boolean }) {
  if (tags.length === 0) return null;
  return (
    <Box
      sx={{
        display: "flex",
        gap: 1,
        flexWrap: wrap ? "wrap" : "nowrap",
        overflowX: wrap ? "visible" : "auto",
        scrollbarWidth: "none",
        "&::-webkit-scrollbar": { display: "none" },
      }}
    >
      {tags.map((t) => (
        <Chip key={t.tagId} label={t.name} size="small" variant="outlined" sx={{ flexShrink: 0 }} />
      ))}
    </Box>
  );
}
