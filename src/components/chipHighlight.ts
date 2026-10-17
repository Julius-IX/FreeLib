import type { SxProps, Theme } from "@mui/material";

export const selectedChipSx: SxProps<Theme> = {
  borderColor: "primary.main",
  boxShadow: (t) => `inset 0 0 0 2px ${t.palette.primary.main}`,
};
