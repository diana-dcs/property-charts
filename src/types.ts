export type ChartType = "line" | "bar" | "heatmap";

export type PropertyValueType = "number" | "boolean" | "rating" | "text";

export interface DataPoint {
  date: Date;
  value: number | string | boolean | null;
  rawValue: unknown;
}

export interface Dataset {
  property: string;
  points: DataPoint[];
  valueType: PropertyValueType;
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
}

export const DEFAULT_SETTINGS: PluginSettings = {
  defaultFolder: "",
  defaultDateFormat: "YYYY-MM-DD",
  defaultChartType: "line",
  defaultRange: "90d",
};

export const CHART_COLORS_HEX = [
  "#6384FF",
  "#FF6384",
  "#4BC0C0",
  "#FFCD56",
  "#9966FF",
  "#FF9F40",
];

export const CSS = {
  view: "chart-plugin-view",
  controls: "chart-plugin-controls",
  canvasContainer: "chart-plugin-canvas-container",
  section: "chart-plugin-section",
  sectionTitle: "chart-plugin-section-title",
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
  removeBtn: "chart-plugin-remove-btn",
  colorInput: "chart-plugin-color-input",
  bottom: "chart-plugin-bottom",
  embed: "chart-plugin-embed",
  error: "chart-plugin-error",
} as const;

