import { Box, Paper, Typography } from "@mui/material";
import { formatRatingNumber } from "@/features/library/rating";
import { useLibrarySummary } from "./useStats";

const whole = new Intl.NumberFormat();

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" noWrap component="div">{label}</Typography>
      <Typography variant="h5" noWrap>{value}</Typography>
      {note && <Typography variant="caption" color="text.secondary" noWrap component="div">{note}</Typography>}
    </Paper>
  );
}

/** The headline numbers of the whole library. Not affected by the question below it. */
export default function StatsSummary() {
  const { data } = useLibrarySummary();
  if (!data) return null;

  return (
    <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(4, 1fr)" } }}>
      <Tile label="Books" value={whole.format(data.books)} />
      <Tile
        label="Finished"
        value={whole.format(data.finished)}
        note={data.inProgress ? `${whole.format(data.inProgress)} in progress` : undefined}
      />
      <Tile label="Pages read" value={whole.format(data.pagesRead)} />
      <Tile
        label="Average rating"
        value={data.avgRating === null ? "\u2013" : formatRatingNumber(data.avgRating)}
        note={data.avgRating === null ? "nothing rated yet" : "out of 10"}
      />
    </Box>
  );
}
