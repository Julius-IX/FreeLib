import { Box, Divider, Typography } from "@mui/material";
import type { Reading } from "@/lib/types";
import { isOpen, readingDuration, readingRange } from "./format";

/** One row per read, already sorted by the caller. */
export function ReadingHistory({ readings }: { readings: Reading[] }) {
  return (
    <Box>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, py: 1 }}>
        {readings.length === 0 ? "Reading history" : `Reading history · ${readings.length}`}
      </Typography>
      <Divider />
      {readings.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
          Not read yet. Use “Start read” in the menu when you begin.
        </Typography>
      ) : (
        readings.map((r) => {
          const duration = readingDuration(r);
          return (
            <Box key={r.readingId}>
              <Box sx={{ py: 1.25 }}>
                <Typography variant="body1">{readingRange(r)}</Typography>
                {isOpen(r) ? (
                  <Typography variant="caption" color="primary">
                    In progress
                  </Typography>
                ) : (
                  duration && (
                    <Typography variant="caption" color="text.secondary">
                      {duration}
                    </Typography>
                  )
                )}
              </Box>
              <Divider />
            </Box>
          );
        })
      )}
    </Box>
  );
}
