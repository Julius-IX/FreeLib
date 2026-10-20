import { useState } from "react";
import { Box, Typography, useTheme } from "@mui/material";
import type { StatsMeasure, StatsRow } from "@/lib/types";
import { formatValue, seriesColor } from "./format";

const SIZE = 180;
const STROKE = 28;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** Slices past this many are added up into one, the rest would be too thin to tell apart. */
const MAX_SLICES = 7;

/** Shares of a whole. Rows come biggest first, so the merged slice is always the smallest ones. */
export default function DonutChart({ rows, measure }: { rows: StatsRow[]; measure: StatsMeasure }) {
  const theme = useTheme();
  const [picked, setPicked] = useState<number | null>(null);

  const shown = rows.slice(0, MAX_SLICES);
  const rest = rows.slice(MAX_SLICES).reduce((sum, r) => sum + r.value, 0);
  const slices = rest > 0 ? [...shown, { label: "Other", value: rest, books: 0 }] : shown;
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  if (total <= 0) return null;

  let offset = 0;
  const arcs = slices.map((s) => {
    const length = (s.value / total) * CIRCUMFERENCE;
    const arc = { length, offset };
    offset += length;
    return arc;
  });
  const percent = (v: number) => `${Math.round((v / total) * 100)}%`;
  const active = picked !== null ? slices[picked] : null;

  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 3 }}>
      <Box sx={{ position: "relative", width: SIZE, height: SIZE, flexShrink: 0 }}>
        <svg width={SIZE} height={SIZE} role="img" onPointerLeave={() => setPicked(null)}>
          <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
            {slices.map((s, i) => (
              <circle
                key={s.label}
                cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none"
                stroke={s.label === "Other" ? theme.palette.text.disabled : seriesColor(theme, i)}
                strokeWidth={picked === i ? STROKE + 6 : STROKE}
                // a hairline gap between slices, without it two neighbours of one colour merge
                strokeDasharray={`${Math.max(arcs[i].length - 1, 0)} ${CIRCUMFERENCE}`}
                strokeDashoffset={-arcs[i].offset}
                onPointerEnter={() => setPicked(i)} onPointerDown={() => setPicked(i)}
              >
                <title>{`${s.label}: ${formatValue(measure, s.value)} (${percent(s.value)})`}</title>
              </circle>
            ))}
          </g>
        </svg>
        <Box
          sx={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", pointerEvents: "none", px: 5, textAlign: "center",
          }}
        >
          <Typography variant="h6" sx={{ lineHeight: 1.2 }}>
            {formatValue(measure, active ? active.value : total)}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: "100%" }}>
            {active ? `${active.label} · ${percent(active.value)}` : "total"}
          </Typography>
        </Box>
      </Box>

      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75, minWidth: 160, flex: "1 1 160px", maxWidth: 320 }}>
        {slices.map((s, i) => (
          <Box
            key={s.label}
            onPointerEnter={() => setPicked(i)} onPointerLeave={() => setPicked(null)}
            sx={{ display: "flex", alignItems: "center", gap: 1, opacity: picked === null || picked === i ? 1 : 0.55 }}
          >
            <Box
              sx={{
                width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
                bgcolor: s.label === "Other" ? "text.disabled" : seriesColor(theme, i),
              }}
            />
            <Typography variant="body2" noWrap sx={{ flex: 1 }}>{s.label}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums" }}>
              {formatValue(measure, s.value)} · {percent(s.value)}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
