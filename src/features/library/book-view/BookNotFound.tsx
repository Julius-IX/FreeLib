import { useState } from "react";
import { Box, Typography } from "@mui/material";
import { randomKaomoji } from "@/assets/kaomoji";

/** Random kaomoji plus what went wrong. The top bar (not part of this) is how the user leaves. */
export function BookNotFound({ message }: { message: string }) {
  const [face] = useState(randomKaomoji); // picked once per visit, not on every re-render
  return (
    <Box sx={{ p: 4, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, textAlign: "center" }}>
      <Typography variant="h3" component="p" sx={{ overflowWrap: "anywhere" }}>
        {face}
      </Typography>
      <Typography variant="h6">Book not found</Typography>
      <Typography variant="body2" color="text.secondary">
        {message}
      </Typography>
    </Box>
  );
}
