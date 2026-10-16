import { useEffect, useState } from "react";
import { Box, Slider, Typography } from "@mui/material";
import { libraryColumnsRange, useLibraryColumns } from "../libraryColumns";

export default function LibraryColumnsField() {
  const { min, max } = libraryColumnsRange();
  const [columns, saveColumns] = useLibraryColumns();

  // Track the slider locally while dragging so we only write to disk on release
  const [draft, setDraft] = useState(columns);
  useEffect(() => setDraft(columns), [columns]);

  return (
    <Box>
      <Typography gutterBottom>Library columns</Typography>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        How many books to show per row in the library. Fewer columns means bigger covers.
      </Typography>
      <Slider
        value={draft}
        onChange={(_, v) => setDraft(v as number)}
        onChangeCommitted={(_, v) => saveColumns(v as number)}
        min={min}
        max={max}
        step={1}
        marks
        valueLabelDisplay="auto"
      />
    </Box>
  );
}
