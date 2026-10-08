import { ChartConfig, colorAt, isDistributionType } from "./types";
import { CODE_BLOCK_LANGUAGE } from "./CodeBlockProcessor";

/** View state the config alone does not carry, but the exported block needs. */
export interface ExportContext {
  /** The year a heatmap is currently showing. */
  heatmapYear: number;
  /** Segment labels of a distribution chart, which the exported colors map onto. */
  segmentLabels: string[];
  /** False while a text property is drawn as a frequency chart, which ignores the range. */
  rangeApplies: boolean;
}

/** Quotes a value as a YAML double-quoted scalar. */
export function yamlQuote(value: string): string {
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
  }"`;
}

/** Renders a scalar-or-list YAML field, collapsing a single entry to the scalar form. */
function yamlField(key: string, values: string[]): string {
  const [only, ...rest] = values;
  if (only === undefined) return "";
  if (rest.length === 0) return `${key}: ${yamlQuote(only)}`;
  return `${key}:\n${values.map((v) => `  - ${yamlQuote(v)}`).join("\n")}`;
}

/**
 * Serializes the sidebar's current state into a ```property-chart block that renders the
 * same chart when pasted into a note.
 */
export function buildCodeblock(config: ChartConfig, ctx: ExportContext): string {
  const activeIndices = config.properties
    .map((property, i) => (property ? i : -1))
    .filter((i) => i >= 0);
  const activeProperties = config.properties.filter(Boolean);

  // For distribution types, colors map to segments rather than to datasets.
  const exportColors = isDistributionType(config.type)
    ? ctx.segmentLabels.map((_, i) => colorAt(config.colors, i))
    : activeIndices.map((i) => colorAt(config.colors, i));

  const lines = [
    "```" + CODE_BLOCK_LANGUAGE,
    `type: ${config.type}`,
    `folder: ${yamlQuote(config.folder)}`,
    yamlField("property", activeProperties),
    yamlField("colors", exportColors),
    `dateFormat: ${config.dateFormat}`,
    rangeLine(config, ctx),
    config.type === "heatmap" ? `year: ${ctx.heatmapYear}` : "",
    "```",
  ];

  return lines.filter(Boolean).join("\n");
}

/**
 * The `range:` line, or "" when the range did not shape the chart.
 *
 * Distribution types always collect every note, a heatmap is bounded by its year, and a
 * text property is drawn as a frequency chart with the range controls hidden. Exporting
 * the stale preset in those cases would make the embedded block filter out data the
 * sidebar is showing.
 */
function rangeLine(config: ChartConfig, ctx: ExportContext): string {
  const applies =
    !isDistributionType(config.type) && config.type !== "heatmap" && ctx.rangeApplies;
  if (!applies) return "";

  if (config.range.preset) return `range: ${config.range.preset}`;
  if (config.range.from && config.range.to) {
    return `range: ${config.range.from}:${config.range.to}`;
  }
  return "";
}
