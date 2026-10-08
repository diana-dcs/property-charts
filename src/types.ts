import { normalizePath } from "obsidian";

export type ChartType = "line" | "bar" | "heatmap" | "pie" | "doughnut" | "polarArea";

/** The chart types that draw one dataset as shares of a whole. */
export type DistributionType = "pie" | "doughnut" | "polarArea";

export const DISTRIBUTION_TYPES: DistributionType[] = ["pie", "doughnut", "polarArea"];

/** Narrows a chart type to a DistributionType, so renderers need no cast. */
export function isDistributionType(type: ChartType): type is DistributionType {
  return (DISTRIBUTION_TYPES as ChartType[]).includes(type);
}

/** Chart types plotted against a numeric axis, as opposed to DISTRIBUTION_TYPES. */
export const TREND_TYPES: ChartType[] = ["line", "bar"];

export const ALL_CHART_TYPES: ChartType[] = ["line", "bar", "heatmap", "pie", "doughnut", "polarArea"];

/** Shared by the settings tab's dropdown and its declarative setting definitions. */
export const CHART_TYPE_LABELS: Record<ChartType, string> = {
  line: "Line",
  bar: "Bar",
  heatmap: "Heatmap",
  pie: "Pie",
  doughnut: "Doughnut",
  polarArea: "Polar area",
};

export type PropertyValueType = "number" | "boolean" | "text";

export interface DataPoint {
  date: Date | null;
  label: string;
  value: number | string | boolean | null;
  rawValue: unknown;
}

/**
 * A point's value as a number, or null when it has none.
 *
 * `value` is a union because a text property keeps its string, which only the frequency
 * chart reads. Numeric charts go through this instead of asserting `as number`, so a
 * string lands as a gap in the line rather than as NaN on the axis.
 */
export function numericValue(point: DataPoint): number | null {
  if (typeof point.value === "number") return Number.isFinite(point.value) ? point.value : null;
  if (typeof point.value === "boolean") return point.value ? 1 : 0;
  return null;
}

export interface Dataset {
  property: string;
  points: DataPoint[];
  valueType: PropertyValueType;
  truncated?: boolean;
  totalCount?: number;
}

/**
 * A chart's full description. Readonly throughout: the sidebar owns one of these and
 * replaces it with an updated copy on every change, so the controls can read it but
 * cannot quietly reshape the view's state from under it.
 */
export interface ChartConfig {
  readonly type: ChartType;
  readonly folder: string;
  readonly properties: readonly string[];
  readonly colors: readonly string[];
  readonly dateFormat: string;
  readonly range: RangeConfig;
  readonly heatmapYear?: number;
}

export type RangePreset = "7d" | "30d" | "90d" | "all";

export const ALL_RANGE_PRESETS: RangePreset[] = ["7d", "30d", "90d", "all"];

export const RANGE_PRESET_LABELS: Record<RangePreset, string> = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  all: "All",
};

/**
 * Length of each preset window in days: the window starts that many days before today
 * and ends today. `null` for "all", which applies no bounds at all.
 *
 * Both the data filter (DataCollector) and the heatmap's cell dimming read this, which
 * is why it lives here — the two used to disagree by a day.
 */
export const RANGE_PRESET_DAYS: Record<RangePreset, number | null> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  all: null,
};

/** Narrows an unvalidated value (e.g. from a code block's YAML) to a ChartType. */
export function isChartType(value: unknown): value is ChartType {
  return typeof value === "string" && (ALL_CHART_TYPES as string[]).includes(value);
}

/** Narrows an unvalidated value (e.g. from a code block's YAML) to a RangePreset. */
export function isRangePreset(value: unknown): value is RangePreset {
  return typeof value === "string" && (ALL_RANGE_PRESETS as string[]).includes(value);
}

export interface RangeConfig {
  preset?: RangePreset;
  from?: string; // YYYY-MM-DD
  to?: string;   // YYYY-MM-DD
}

export interface PluginSettings {
  defaultFolder: string;
  defaultDateFormat: string;
  defaultChartType: ChartType;
  defaultRange: RangePreset;
  fileLimit: number; // 0 = unlimited
}

export const DEFAULT_SETTINGS: PluginSettings = {
  defaultFolder: "",
  defaultDateFormat: "YYYY-MM-DD",
  defaultChartType: "line",
  defaultRange: "90d",
  fileLimit: 5000,
};

/** Typed as non-empty so the first entry is always available as a fallback. */
export const CHART_COLORS_HEX: readonly [string, ...string[]] = [
  "#6384FF",
  "#FF6384",
  "#4BC0C0",
  "#FFCD56",
  "#9966FF",
  "#FF9F40",
];

/**
 * The color for the nth dataset or segment: the user's choice if present, otherwise the
 * default palette, which repeats once there are more series than colors.
 */
export function colorAt(colors: readonly string[] | undefined, index: number): string {
  return (
    colors?.[index] ??
    CHART_COLORS_HEX[index % CHART_COLORS_HEX.length] ??
    CHART_COLORS_HEX[0]
  );
}

/**
 * Whether the collected data holds text rather than numbers — which decides between a
 * time series and a frequency chart, and locks the heatmap.
 *
 * Empty datasets are not text: with no values there is nothing to infer a type from, so
 * reporting text would wrongly disable controls for a property that simply has no data
 * in range yet.
 */
export function isTextDatasets(datasets: Dataset[]): boolean {
  return (
    datasets.some((d) => d.points.length > 0) &&
    datasets.every((d) => d.valueType === "text")
  );
}

/**
 * Counts how often each value occurs across the given points, expanding list properties
 * into one count per element.
 *
 * A Map rather than an object: the keys are arbitrary frontmatter values, and a note with
 * `tag: __proto__` would otherwise hit the object prototype instead of its own entry.
 */
export function countValueFrequencies(points: DataPoint[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const point of points) {
    for (const value of toValueStrings(point.rawValue)) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return counts;
}

/** The full-year bounds a heatmap is drawn against. */
export function yearRange(year: number): RangeConfig {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

/**
 * Whether a file path lies inside a folder. "/" and "" both mean the vault root, which
 * contains every file.
 */
export function isInFolder(filePath: string, folder: string): boolean {
  if (folder === "/" || folder === "") return true;
  return filePath.startsWith(folder + "/");
}

const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNCTIONAL_COLOR = /^(?:rgb|hsl)a?\([^()]*\)$/i;

/** The CSS named colors most likely to be typed by hand into a code block. */
const NAMED_COLORS = new Set([
  "transparent", "black", "white", "red", "green", "blue", "yellow", "orange",
  "purple", "pink", "brown", "gray", "grey", "cyan", "magenta", "lime", "navy",
  "teal", "olive", "maroon", "silver", "gold", "indigo", "violet", "turquoise",
  "salmon", "coral", "crimson", "khaki", "lavender", "beige", "tan", "plum",
  "orchid", "aqua", "fuchsia",
]);

/**
 * Checks whether a string is a color Chart.js can actually paint with. Invalid colors
 * are otherwise ignored silently and the series renders transparent.
 *
 * Inside Obsidian the browser engine makes the final call, so uncommon-but-valid CSS
 * colors are accepted too. Note `CSS` here must be read off globalThis — this module
 * exports its own `CSS` constant, which shadows the global.
 */
export function isValidColor(value: string): boolean {
  const v = value.trim();
  if (v === "") return false;
  if (HEX_COLOR.test(v) || FUNCTIONAL_COLOR.test(v) || NAMED_COLORS.has(v.toLowerCase())) {
    return true;
  }
  const cssApi = (globalThis as { CSS?: { supports?: (p: string, v: string) => boolean } }).CSS;
  return typeof cssApi?.supports === "function" ? cssApi.supports("color", v) : false;
}

/** Extracts a displayable message from an unknown catch binding. */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Stringifies an untyped frontmatter/YAML scalar for display. Objects and arrays go
 * through JSON so they never surface as "[object Object]".
 */
export function toDisplayString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === undefined || value === null) return "";
  return JSON.stringify(value) ?? "";
}

/**
 * Expands a raw frontmatter value into display strings. List properties contribute
 * one string per element, so each list item counts as its own data point. Empty
 * elements are dropped so they cannot form a blank category.
 */
export function toValueStrings(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  const items = Array.isArray(raw) ? (raw as unknown[]) : [raw];
  return items
    .filter((item) => item !== undefined && item !== null)
    .map(toDisplayString);
}

/** Removes Obsidian wiki-link brackets: [[link]] → link, [[link|alias]] → alias */
export function stripWikiLinks(s: string): string {
  // The replacer's rest params are typed `any[]`, so annotate them explicitly.
  return s.replace(
    /\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g,
    (_match: string, target: string, alias?: string) => alias ?? target,
  );
}

/** Normalizes a user-entered folder path while keeping "/" (vault root) and "" (unset) intact. */
export function normalizeFolderPath(path: string): string {
  const trimmed = path.trim();
  if (trimmed === "" || trimmed === "/") return trimmed;
  return normalizePath(trimmed);
}

export const CSS = {
  view: "chart-plugin-view",
  controls: "chart-plugin-controls",
  canvasContainer: "chart-plugin-canvas-container",
  section: "chart-plugin-section",
  sectionTitle: "chart-plugin-section-title",
  sectionTitleRow: "chart-plugin-section-title-row",
  row: "chart-plugin-row",
  rowEnd: "chart-plugin-row--end",
  btnGroup: "chart-plugin-btn-group",
  toggleBtn: "chart-plugin-toggle-btn",
  propSection: "chart-plugin-prop-section",
  addBtn: "chart-plugin-add-btn",
  dateInput: "chart-plugin-date-input",
  dateError: "chart-plugin-date-error",
  actions: "chart-plugin-actions",
  copyBtn: "chart-plugin-copy-btn",
  resetBtn: "chart-plugin-reset-btn",
  removeBtn: "chart-plugin-remove-btn",
  colorInput: "chart-plugin-color-input",
  dataHint: "chart-plugin-data-hint",
  disabledHint: "chart-plugin-disabled-hint",
  bottom: "chart-plugin-bottom",
  embed: "chart-plugin-embed",
  error: "chart-plugin-error",
  scrollArea: "chart-plugin-scroll-area",
  yearNav: "chart-plugin-year-nav",
  hint: "chart-plugin-hint",
  noDataMsg: "chart-plugin-no-data-msg",
  btnSpacer: "chart-plugin-btn-spacer",
  btnDisabled: "chart-plugin-btn-disabled",
  embedNoData: "chart-plugin-embed-no-data",
  limit: "chart-plugin-limit",
  limitWarn: "chart-plugin-limit--warn",
  limitOk: "chart-plugin-limit--ok",
  heatmapContainer: "chart-plugin-canvas-container--heatmap",
  heatmapWrapper: "chart-plugin-heatmap-wrapper",
  heatmapChart: "chart-plugin-heatmap-chart",
  heatmapLegend: "chart-plugin-heatmap-legend",
  heatmapLegendLabel: "chart-plugin-heatmap-legend-label",
  heatmapLegendCell: "chart-plugin-heatmap-legend-cell",
} as const;

/** CSS custom properties set from code for values computed at render time. */
export const CSS_VARS = {
  containerHeight: "--chart-plugin-height",
  heatmapWidth: "--chart-plugin-heatmap-width",
  heatmapHeight: "--chart-plugin-heatmap-height",
  heatmapChartHeight: "--chart-plugin-heatmap-chart-height",
  legendHeight: "--chart-plugin-legend-height",
  legendPaddingRight: "--chart-plugin-legend-padding-right",
  legendCellSize: "--chart-plugin-legend-cell-size",
  legendCellColor: "--chart-plugin-legend-cell-color",
} as const;

