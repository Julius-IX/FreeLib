import { useCallback, useState } from "react";
import { RouteObject } from "react-router-dom";
import {
  Alert, Box, CircularProgress, LinearProgress, Paper, ToggleButton, ToggleButtonGroup, Typography,
} from "@mui/material";
import StatsBuilder from "./StatsBuilder";
import StatsSummary from "./StatsSummary";
import StatsChart from "./charts/StatsChart";
import {
  CHART_LABELS, NOTES, type ChartKind, type StatsForm, activeChart, chartKinds, defaultForm, groupInfo, measureInfo,
} from "./options";
import { useStatsResult } from "./useStats";

const whole = new Intl.NumberFormat();

function StatsHome() {
  // The tab stays mounted while another one is open, so the question survives switching tabs.
  const [form, setForm] = useState(defaultForm);
  const change = useCallback((patch: Partial<StatsForm>) => setForm((f) => ({ ...f, ...patch })), []);
  const { data, error, loading } = useStatsResult(form);

  const kind = activeChart(form);
  const kinds = chartKinds(form.groupBy, form.measure);
  const note = NOTES[form.groupBy];

  return (
    <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2, maxWidth: 900, mx: "auto" }}>
      <Box sx={{ pb: 1, borderBottom: 1, borderColor: "divider" }}>
        <Typography variant="h5">Stats</Typography>
      </Box>

      <StatsSummary />
      <StatsBuilder form={form} onChange={change} />

      <Paper variant="outlined" sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2, overflow: "hidden" }}>
        <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1">
              {measureInfo(form.measure).short} by {groupInfo(form.groupBy).by}
            </Typography>
            {data && (
              <Typography variant="caption" color="text.secondary">
                {whole.format(data.matchingBooks)} {data.matchingBooks === 1 ? "book matches" : "books match"}
              </Typography>
            )}
          </Box>
          {kinds.length > 1 && (
            <ToggleButtonGroup
              exclusive size="small" value={kind}
              onChange={(_, v: ChartKind | null) => v && change({ chart: v })}
            >
              {kinds.map((k) => <ToggleButton key={k} value={k}>{CHART_LABELS[k]}</ToggleButton>)}
            </ToggleButtonGroup>
          )}
        </Box>

        {loading && data && <LinearProgress sx={{ mt: -1 }} />}
        {error && <Alert severity="error">Couldn't run the query: {error}</Alert>}
        {!data && loading && <CircularProgress sx={{ alignSelf: "center", m: 4 }} />}

        {data && data.rows.length === 0 && (
          <Typography color="text.secondary" sx={{ py: 4, textAlign: "center" }}>
            Nothing to show. Either no book matches the filters, or none has a value to group by.
          </Typography>
        )}
        {data && data.rows.length > 0 && <StatsChart rows={data.rows} measure={form.measure} kind={kind} />}

        {note && data && data.rows.length > 0 && (
          <Typography variant="caption" color="text.secondary">{note}</Typography>
        )}
      </Paper>
    </Box>
  );
}

export const statsRoutes: RouteObject[] = [{ index: true, element: <StatsHome /> }];
