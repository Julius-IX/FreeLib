import type { StatsMeasure, StatsRow } from "@/lib/types";
import type { ChartKind } from "../options";
import AxisChart from "./AxisChart";
import BarChart from "./BarChart";
import DonutChart from "./DonutChart";

export default function StatsChart({ rows, measure, kind }: { rows: StatsRow[]; measure: StatsMeasure; kind: ChartKind }) {
  switch (kind) {
    case "bar": return <BarChart rows={rows} measure={measure} />;
    case "donut": return <DonutChart rows={rows} measure={measure} />;
    case "column":
    case "line": return <AxisChart rows={rows} measure={measure} variant={kind} />;
  }
}
