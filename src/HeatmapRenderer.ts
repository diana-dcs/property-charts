import { Chart, ChartConfiguration, ScriptableContext } from "chart.js/auto";
import { MatrixController, MatrixElement } from "chartjs-chart-matrix";
import type { MatrixDataPoint } from "chartjs-chart-matrix";
import { moment } from "obsidian";
import { CSS, CSS_VARS, RangeConfig } from "./types";

Chart.register(MatrixController, MatrixElement);

export interface HeatmapPoint {
  date: string; // YYYY-MM-DD
  value: number | boolean | null;
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const NUM_WEEKS = 53;
const CELL = 11;    // cell size in px
const GAP = 2;      // gap between cells
const PITCH = CELL + GAP;
const Y_AXIS_W = 36;
const X_AXIS_H = 24;
const LEGEND_H = 22;

// Default wrapper width (fallback before first layout pass)
export const HEATMAP_WRAPPER_W = NUM_WEEKS * PITCH + Y_AXIS_W; // 725px

/** Compute wrapper/chart/total heights for a given available pixel width. */
export function computeHeatmapDimensions(availW: number): {
  pitch: number;
  wrapperH: number;
  totalH: number;
} {
  const pitch = Math.max(Math.floor((availW - Y_AXIS_W) / NUM_WEEKS), CELL + GAP);
  const wrapperH = 7 * pitch + X_AXIS_H;
  const totalH = wrapperH + LEGEND_H;
  return { pitch, wrapperH, totalH };
}

function hexToRgb(hex: string): [number, number, number] | null {
  const short = hex.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (short) {
    return [
      parseInt(short[1] + short[1], 16),
      parseInt(short[2] + short[2], 16),
      parseInt(short[3] + short[3], 16),
    ];
  }
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

/**
 * Resolves any CSS color (named colors included) to RGB by letting the canvas
 * normalize it. The heatmap interpolates between two RGB triples, so a color it
 * cannot parse would silently render as the neutral fallback.
 */
function cssColorToRgb(value: string): [number, number, number] | null {
  if (typeof document?.createElement !== "function") return null;
  try {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return null;
    // An unparseable value leaves fillStyle untouched, so an unlikely sentinel
    // doubles as the failure signal — and never collides with a real request.
    const sentinel = "#010203";
    ctx.fillStyle = sentinel;
    ctx.fillStyle = value;
    const normalized = ctx.fillStyle;
    if (typeof normalized !== "string" || normalized === sentinel) return null;
    return hexToRgb(normalized) ?? parseRgbFunction(normalized);
  } catch {
    return null;
  }
}

function parseRgbFunction(css: string): [number, number, number] | null {
  const rgb = css.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return rgb ? [parseInt(rgb[1]), parseInt(rgb[2]), parseInt(rgb[3])] : null;
}

/** Resolves a user-supplied chart color, trying hex, rgb() and then the canvas. */
function resolveDataColor(value: string): [number, number, number] | null {
  const trimmed = value.trim();
  return hexToRgb(trimmed) ?? parseRgbFunction(trimmed) ?? cssColorToRgb(trimmed);
}

/** Parses a theme color, falling back to a neutral gray when the variable is unset. */
function parseCssColor(css: string): [number, number, number] {
  return parseRgbFunction(css) ?? hexToRgb(css.trim()) ?? [200, 200, 200];
}

function lerpRgba(
  r1: number, g1: number, b1: number,
  r2: number, g2: number, b2: number,
  t: number,
  a: number
): string {
  return `rgba(${Math.round(r1+(r2-r1)*t)},${Math.round(g1+(g2-g1)*t)},${Math.round(b1+(b2-b1)*t)},${a})`;
}

function resolveRange(range: RangeConfig): { from: Date | null; to: Date | null } {
  if (range.from && range.to) {
    return { from: new Date(range.from + "T00:00:00"), to: new Date(range.to + "T23:59:59") };
  }
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (range.preset === "7d")  { const f = new Date(today); f.setDate(today.getDate()-6);  return { from: f, to: today }; }
  if (range.preset === "30d") { const f = new Date(today); f.setDate(today.getDate()-29); return { from: f, to: today }; }
  if (range.preset === "90d") { const f = new Date(today); f.setDate(today.getDate()-89); return { from: f, to: today }; }
  return { from: null, to: null };
}

interface GridPoint {
  x: number;
  y: number;
  v: number | null;
  date: string;
  inYear: boolean;
}

export function renderHeatmap(
  canvas: HTMLCanvasElement,
  data: HeatmapPoint[],
  colorHex: string,
  year: number,
  range: RangeConfig,
  isBooleanProp: boolean
): Chart {
  const emptyColorStr = getComputedStyle(document.body)
    .getPropertyValue("--background-modifier-border").trim() || "#d0d0d0";
  const emptyRgb = parseCssColor(emptyColorStr);
  const dataRgb = resolveDataColor(colorHex) ?? [99, 132, 255];

  const valueMap = new Map<string, number | boolean | null>();
  for (const pt of data) valueMap.set(pt.date, pt.value);

  let maxValue = 1;
  if (!isBooleanProp) {
    for (const pt of data) {
      if (typeof pt.value === "number" && pt.value > maxValue) maxValue = pt.value;
    }
  }

  const { from: rangeFrom, to: rangeTo } = resolveRange(range);

  const jan1 = moment(`${year}-01-01`);
  const startOfGrid = jan1.clone().startOf("isoWeek");

  const monthWeeks = new Map<number, string>();
  for (let m = 0; m < 12; m++) {
    const firstOfMonth = moment(`${year}-${String(m+1).padStart(2,"0")}-01`);
    const wIdx = Math.floor(firstOfMonth.diff(startOfGrid, "days") / 7);
    if (wIdx >= 0 && wIdx < NUM_WEEKS && !monthWeeks.has(wIdx)) {
      monthWeeks.set(wIdx, MONTH_LABELS[m]);
    }
  }

  const gridData: GridPoint[] = [];
  for (let w = 0; w < NUM_WEEKS; w++) {
    for (let d = 0; d < 7; d++) {
      const m = startOfGrid.clone().add(w * 7 + d, "days");
      const dateStr = m.format("YYYY-MM-DD");
      const inYear = m.year() === year;
      let v: number | null = null;
      if (inYear) {
        const raw = valueMap.get(dateStr);
        if (raw !== undefined && raw !== null) {
          v = isBooleanProp ? (raw ? 1 : 0) : typeof raw === "number" ? raw : null;
        }
      }
      gridData.push({ x: w, y: d, v, date: dateStr, inYear });
    }
  }

  function isInRange(dateStr: string): boolean {
    if (!rangeFrom && !rangeTo) return true;
    const d = new Date(dateStr + "T12:00:00");
    if (rangeFrom && d < rangeFrom) return false;
    if (rangeTo && d > rangeTo) return false;
    return true;
  }

  function cellColor(pt: GridPoint, opacity: number): string {
    if (!pt.inYear) return "transparent";
    if (pt.v === null || (isBooleanProp && pt.v === 0)) {
      return `rgba(${emptyRgb[0]},${emptyRgb[1]},${emptyRgb[2]},${opacity})`;
    }
    const t = isBooleanProp ? 1 : Math.min(pt.v / maxValue, 1);
    return lerpRgba(emptyRgb[0], emptyRgb[1], emptyRgb[2], dataRgb[0], dataRgb[1], dataRgb[2], t, opacity);
  }

  const cfg: ChartConfiguration<'matrix'> = {
    type: "matrix",
    data: {
      datasets: [{
        label: "",
        // GridPoint satisfies MatrixDataPoint (x, y, v) and carries extra fields
        // accessible via ctx.raw — the cast is unavoidable because MatrixDataPoint
        // declares v as optional while GridPoint uses number | null.
        data: gridData as unknown as MatrixDataPoint[],
        backgroundColor(ctx: ScriptableContext<'matrix'>) {
          const pt = ctx.raw as GridPoint;
          return cellColor(pt, isInRange(pt.date) ? 1 : 0.15);
        },
        borderColor: "transparent",
        borderWidth: 1,
        borderRadius: 2,
        // Both dimensions derived from chart area WIDTH → always square cells
        width:  ({ chart }: ScriptableContext<'matrix'>) => Math.max(Math.floor((chart.chartArea?.width  ?? NUM_WEEKS*PITCH) / NUM_WEEKS) - GAP, 4),
        height: ({ chart }: ScriptableContext<'matrix'>) => Math.max(Math.floor((chart.chartArea?.width  ?? NUM_WEEKS*PITCH) / NUM_WEEKS) - GAP, 4),
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title(items) { return (items[0]?.raw as GridPoint)?.date ?? ""; },
            label(item) {
              const pt = item.raw as GridPoint;
              if (!pt.inYear || pt.v === null) return "No entry";
              if (isBooleanProp) return pt.v ? "true" : "false";
              return String(pt.v);
            },
          },
        },
      },
      scales: {
        x: {
          type: "linear",
          min: -0.5,
          max: NUM_WEEKS - 0.5,
          offset: false,
          grid: { display: false },
          border: { display: false },
          ticks: {
            stepSize: 1,
            autoSkip: false,
            maxRotation: 0,
            font: { size: 11 },
            callback(val: string | number) {
              const w = Math.round(Number(val));
              return monthWeeks.get(w) ?? null;
            },
          },
        },
        y: {
          type: "linear",
          min: -0.5,
          max: 6.5,
          reverse: true,   // Mon (d=0) at top, Sun (d=6) at bottom — GitHub layout
          grid: { display: false },
          border: { display: false },
          ticks: {
            stepSize: 1,
            autoSkip: false,
            font: { size: 11 },
            callback(val: string | number) {
              const d = Math.round(Number(val));
              if (d === 0) return "Mon";
              if (d === 2) return "Wed";
              if (d === 4) return "Fri";
              return "";
            },
          },
        },
      },
      layout: { padding: { right: 4 } },
    },
  };
  return new Chart(canvas, cfg);
}

/** Appends a "Less ░▒▓█ More" legend row to the given container element. */
export function renderHeatmapLegend(
  container: HTMLElement,
  colorHex: string
): void {
  const emptyColorStr = getComputedStyle(document.body)
    .getPropertyValue("--background-modifier-border").trim() || "#d0d0d0";
  const emptyRgb = parseCssColor(emptyColorStr);
  const dataRgb = resolveDataColor(colorHex) ?? [99, 132, 255];

  const legend = container.createDiv({ cls: CSS.heatmapLegend });
  legend.setCssProps({
    [CSS_VARS.legendHeight]: `${LEGEND_H}px`,
    [CSS_VARS.legendPaddingRight]: `${Y_AXIS_W - 4}px`,
    [CSS_VARS.legendCellSize]: `${CELL}px`,
  });

  const label = (text: string) => {
    legend.createSpan({ cls: CSS.heatmapLegendLabel, text });
  };

  const steps = [0, 0.25, 0.5, 0.75, 1];

  label("Less");
  for (const t of steps) {
    const sq = legend.createDiv({ cls: CSS.heatmapLegendCell });
    const col = t === 0
      ? `rgba(${emptyRgb[0]},${emptyRgb[1]},${emptyRgb[2]},1)`
      : lerpRgba(emptyRgb[0], emptyRgb[1], emptyRgb[2], dataRgb[0], dataRgb[1], dataRgb[2], t, 1);
    sq.setCssProps({ [CSS_VARS.legendCellColor]: col });
  }
  label("More");
}
