import { Box, Tooltip, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import type { StatsMeasure, StatsRow } from "@/lib/types";
import { axisMax, formatValue } from "./format";

/** One row per group, label on the left and value on the right. Plain DOM on purpose, long labels
 * truncate and a phone never has to scroll sideways. */
export default function BarChart({ rows, measure }: { rows: StatsRow[]; measure: StatsMeasure }) {
  const max = axisMax(measure, rows.map((r) => r.value));

  return (
    <Box role="list" sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {rows.map((row) => {
        const share = max > 0 ? (row.value / max) * 100 : 0;
        return (
          <Box
            key={row.label}
            role="listitem"
            sx={{ display: "grid", gridTemplateColumns: "minmax(80px, 32%) 1fr auto", gap: 1.5, alignItems: "center" }}
          >
            <Tooltip title={row.label} placement="top-start" enterTouchDelay={0}>
              <Typography variant="body2" noWrap>{row.label}</Typography>
            </Tooltip>
            <Box
              sx={{
                height: 14, borderRadius: 1, overflow: "hidden",
                bgcolor: (t) => alpha(t.palette.primary.main, 0.12),
              }}
            >
              <Box
                sx={{
                  height: "100%", borderRadius: 1, bgcolor: "primary.main",
                  width: `${row.value > 0 ? Math.max(share, 1) : 0}%`,
                }}
              />
            </Box>
            <Typography variant="body2" sx={{ minWidth: 44, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
              {formatValue(measure, row.value)}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}
