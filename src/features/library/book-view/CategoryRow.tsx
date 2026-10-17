import { Box } from "@mui/material";
import type { Category } from "@/lib/types";
import { CategoryChip } from "@/components/CategoryChip";
import { useCategoryStyle } from "../categoryStyle";

/**
 * The book's categories, coloured, in the style picked in settings. Same layout as `TagRow`:
 * one scrollable line (touch), or wrapped (`wrap`, for the wider desktop column).
 */
export function CategoryRow({ categories, wrap = false }: { categories: Category[]; wrap?: boolean }) {
  const [style] = useCategoryStyle();
  if (categories.length === 0) return null;
  return (
    <Box
      sx={{
        display: "flex",
        gap: 1,
        alignItems: "flex-start",
        flexWrap: wrap ? "wrap" : "nowrap",
        overflowX: wrap ? "visible" : "auto",
        scrollbarWidth: "none",
        "&::-webkit-scrollbar": { display: "none" },
      }}
    >
      {categories.map((c) => (
        <CategoryChip key={c.categoryId} category={c} variant={style} />
      ))}
    </Box>
  );
}
