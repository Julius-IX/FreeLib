import { Box } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";

export function BookCoverImage({ url, title, sx }: { url: string; title: string; sx?: SxProps<Theme> }) {
  return (
    <Box
      component="img"
      src={url}
      alt={title}
      sx={[
        { display: "block", aspectRatio: "2 / 3", objectFit: "cover", borderRadius: 2, boxShadow: 3 },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    />
  );
}
