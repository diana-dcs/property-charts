import { normalizePath } from "obsidian";

export type ChartType = "line" | "bar" | "heatmap" | "pie" | "doughnut" | "polarArea";

export const DISTRIBUTION_TYPES: ChartType[] = ["pie", "doughnut", "polarArea"];

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

export interface Dataset {
  property: string;
  points: DataPoint[];
  valueType: PropertyValueType;
  truncated?: boolean;
  totalCount?: number;
}

export interface ChartConfig {
  type: ChartType;
  folder: string;
  properties: string[];
  colors: string[];
  dateFormat: string;
  range: RangeConfig;
  heatmapYear?: number;
}

export type RangePreset = "7d" | "30d" | "90d" | "all";

export const ALL_RANGE_PRESETS: RangePreset[] = ["7d", "30d", "90d", "all"];

export const RANGE_PRESET_LABELS: Record<RangePreset, string> = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  all: "All",
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

export const CHART_COLORS_HEX = [
  "#6384FF",
  "#FF6384",
  "#4BC0C0",
  "#FFCD56",
  "#9966FF",
  "#FF9F40",
];

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

