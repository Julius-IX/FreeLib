import { useState } from "react";
import { Box, Typography, useTheme } from "@mui/material";
import { alpha } from "@mui/material/styles";
import type { StatsMeasure, StatsRow } from "@/lib/types";
import { axisMax, formatTick, formatValue, niceTicks } from "./format";
import { useWidth } from "./useWidth";

const HEIGHT = 260;
const PAD = { top: 12, right: 12, bottom: 28, left: 40 };
/** Rough width of one character of an axis label, to work out how many labels fit. */
const CHAR_PX = 6.5;
const MAX_COLUMN_PX = 48;
/** Past this many points the dots of a line only add noise. */
const MAX_DOTS = 40;

/** Values over an ordered axis (years, months, rating steps), as columns or as a line. */
export default function AxisChart({
  rows, measure, variant,
}: { rows: StatsRow[]; measure: StatsMeasure; variant: "column" | "line" }) {
  const theme = useTheme();
  const [ref, width] = useWidth<HTMLDivElement>();
  // Tapping works where hovering doesn't, so the picked point is also named in a line of text.
  const [picked, setPicked] = useState<number | null>(null);

  if (!rows.length) return null;

  const ticks = niceTicks(axisMax(measure, rows.map((r) => r.value)), measure !== "avgRating");
  const top = ticks[ticks.length - 1];
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const slot = rows.length ? plotW / rows.length : 0;
  const x = (i: number) => PAD.left + slot * (i + 0.5);
  const y = (v: number) => PAD.top + plotH * (1 - v / top);

  const labelEvery = Math.max(1, Math.ceil((Math.max(...rows.map((r) => r.label.length)) * CHAR_PX + 8) / (slot || 1)));
  const color = theme.palette.primary.main;
  const line = rows.map((r, i) => `${i ? "L" : "M"}${x(i)},${y(r.value)}`).join("");
  const active = picked !== null ? rows[picked] : null;

  return (
    <Box ref={ref} sx={{ width: "100%" }}>
      <Typography variant="body2" color="text.secondary" sx={{ minHeight: 24 }}>
        {active ? `${active.label}: ${formatValue(measure, active.value)}` : "\u00a0"}
      </Typography>
      {width > 0 && (
        <svg width={width} height={HEIGHT} role="img" onPointerLeave={() => setPicked(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={theme.palette.divider} />
              <text x={PAD.left - 6} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill={theme.palette.text.secondary}>
                {formatTick(t)}
              </text>
            </g>
          ))}

          {variant === "line" && rows.length > 1 && (
            <>
              <path d={`${line}L${x(rows.length - 1)},${y(0)}L${x(0)},${y(0)}Z`} fill={alpha(color, 0.12)} />
              <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
            </>
          )}

          {rows.map((row, i) => {
            const barW = Math.min(slot * 0.7, MAX_COLUMN_PX);
            const lit = picked === i;
            return (
              <g key={row.label}>
                {variant === "column" && (
                  <rect
                    x={x(i) - barW / 2} y={y(row.value)} width={barW} height={y(0) - y(row.value)}
                    rx={3} fill={color} opacity={picked === null || lit ? 1 : 0.5}
                  />
                )}
                {variant === "line" && (rows.length <= MAX_DOTS || lit) && (
                  <circle cx={x(i)} cy={y(row.value)} r={lit ? 5 : 3} fill={color} />
                )}
                {i % labelEvery === 0 && (
                  <text x={x(i)} y={HEIGHT - 8} textAnchor="middle" fontSize={11} fill={theme.palette.text.secondary}>
                    {row.label}
                  </text>
                )}
                {/* A full-height strip per point, so a thin column is still easy to hit. */}
                <rect
                  x={x(i) - slot / 2} y={PAD.top} width={slot} height={plotH} fill="transparent"
                  onPointerEnter={() => setPicked(i)} onPointerDown={() => setPicked(i)}
                >
                  <title>{`${row.label}: ${formatValue(measure, row.value)}`}</title>
                </rect>
              </g>
            );
          })}
        </svg>
      )}
    </Box>
  );
}
