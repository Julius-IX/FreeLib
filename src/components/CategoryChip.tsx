import { Box, Chip, type ChipProps } from "@mui/material";
import type { Category } from "@/lib/types";
import { readableOn, type CategoryStyle } from "@/features/library/categoryStyle";

type Props = Omit<ChipProps, "label" | "variant" | "icon" | "color"> & {
  /** Only `name` and `color` are used, so an unsaved preview works too. */
  category: Pick<Category, "name" | "color">;
  /** How the colour is shown, see `CategoryStyle`. */
  variant: CategoryStyle;
  /**
   * What the chip looks like where the colour isn't the background (everything but "filled").
   * Pass the same as the tag chips next to it: "outlined" in the book view, "filled" (the grey
   * default) in the form fields.
   */
  base?: "filled" | "outlined";
};

/**
 * A category as a MUI `Chip`, so it behaves and is shaped exactly like a tag chip, and takes
 * the same props (`onClick`, `onDelete`, `size`, `sx`, and whatever `TagField` hands its chips).
 */
export function CategoryChip({ category, variant, base = "outlined", sx, size = "small", ...chipProps }: Props) {
  const { name, color } = category;
  const filled = variant === "filled";
  const bar = variant === "bar";
  const marker = variant === "dot" || variant === "square";
  const own = {
    ...(filled && {
      bgcolor: color,
      color: readableOn(color),
      borderColor: color,
      "&:hover, &.Mui-focusVisible": { bgcolor: color, filter: "brightness(0.93)" },
      "& .MuiChip-deleteIcon": { color: "inherit", opacity: 0.7, "&:hover": { color: "inherit", opacity: 1 } },
    }),
    ...(marker && { "& .MuiChip-icon": { ml: "8px", mr: "-2px" } }),
    ...(bar && {
      height: "auto",
      minHeight: size === "small" ? 24 : 32,
      borderRadius: "8px",
      py: 0.5,
      "& .MuiChip-label": { display: "block", p: 0 },
    }),
  };

  return (
    <Chip
      {...chipProps}
      size={size}
      variant={filled ? "filled" : base}
      label={
        bar ? (
          <Box sx={{ px: size === "small" ? 1 : 1.5, textAlign: "center" }}>
            <Box aria-hidden sx={{ height: 4, borderRadius: 999, bgcolor: color, mb: 0.5 }} />
            {name}
          </Box>
        ) : (
          name
        )
      }
      icon={
        marker ? (
          <Box
            aria-hidden
            component="span"
            sx={{
              width: size === "small" ? 10 : 12,
              height: size === "small" ? 10 : 12,
              flexShrink: 0,
              borderRadius: variant === "dot" ? "50%" : "3px",
              bgcolor: color,
            }}
          />
        ) : undefined
      }
      sx={[own, ...(Array.isArray(sx) ? sx : sx ? [sx] : [])] as ChipProps["sx"]}
    />
  );
}
