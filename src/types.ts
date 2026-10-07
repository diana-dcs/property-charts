import { normalizePath } from "obsidian";

export type ChartType = "line" | "bar" | "heatmap" | "pie" | "doughnut" | "polarArea";

export const DISTRIBUTION_TYPES: ChartType[] = ["pie", "doughnut", "polarArea"];

export const ALL_CHART_TYPES: ChartType[] = ["line", "bar", "heatmap", "pie", "doughnut", "polarArea"];

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

/** Removes Obsidian wiki-link brackets: [[link]] → link, [[link|alias]] → alias */
export function stripWikiLinks(s: string): string {
  return s.replace(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_, target, alias) => alias ?? target);
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

