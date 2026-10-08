import { App, MarkdownPostProcessorContext, MarkdownRenderChild, debounce, parseYaml } from "obsidian";
import { ChartConfig, CHART_COLORS_HEX, CSS, DISTRIBUTION_TYPES, ALL_CHART_TYPES, RangePreset, PluginSettings, normalizeFolderPath, isChartType, isRangePreset, isValidColor, errorMessage, toDisplayString, toValueStrings } from "./types";
import { DataCollector } from "./DataCollector";
import { ChartRenderer } from "./ChartRenderer";

/** Language identifier of the fenced code block, e.g. ```property-chart */
export const CODE_BLOCK_LANGUAGE = "property-chart";

/**
 * The shape of a parsed code block. Every field is `unknown` because the values come
 * straight from user-authored YAML — buildConfig() is responsible for validating them.
 */
interface CodeBlockConfig {
  type?: unknown;
  folder?: unknown;
  property?: unknown;
  colors?: unknown;
  dateFormat?: unknown;
  range?: unknown;
  year?: unknown;
}

/** Normalizes a scalar-or-list YAML field into a list of non-empty strings. */
function toStringList(value: unknown): string[] {
  return toValueStrings(value).filter((item) => item !== "");
}

export class CodeBlockProcessor {
  private collector: DataCollector;
  private renderers: Map<HTMLElement, ChartRenderer> = new Map();
  // Stored so scheduleRefreshAll can re-render with fresh data
  private refreshCallbacks: Map<HTMLElement, { folder: string; refresh: () => Promise<boolean> }> = new Map();

  constructor(private app: App, private settings: PluginSettings) {
    this.collector = new DataCollector(app, settings);
  }

  updateSettings(settings: PluginSettings): void {
    this.settings = settings;
    this.collector.updateSettings(settings);
  }

  clearPropertyCache(filePath?: string): void {
    this.collector.clearPropertyCache(filePath);
  }

  async process(
    source: string,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext
  ): Promise<void> {
    el.addClass(CSS.embed);

    // Ties the chart's lifetime to the rendered code block: Obsidian unloads the child
    // when the block is re-rendered, the note is closed or the plugin is disabled.
    const child = new MarkdownRenderChild(el);
    child.register(() => {
      this.renderers.get(el)?.destroy();
      this.renderers.delete(el);
      this.refreshCallbacks.delete(el);
    });
    ctx.addChild(child);

    let raw: CodeBlockConfig;
    try {
      if (source.length > 10_000) {
        throw new Error("Config exceeds 10 000 character limit");
      }
      const parsed: unknown = parseYaml(source);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("Chart config must be a YAML mapping");
      }
      raw = parsed;
    } catch (e) {
      el.createEl("p", {
        text: `Invalid YAML configuration: ${errorMessage(e)} — check indentation and quotes.`,
        cls: CSS.error,
      });
      return;
    }

    // buildConfig validates every field and throws on bad input (unknown chart type,
    // invalid dateFormat, range or year). Without this catch the rejection escapes
    // process() and the code block renders nothing at all — no chart, no message.
    let config: ChartConfig;
    try {
      config = this.buildConfig(raw);
    } catch (e) {
      el.createEl("p", {
        text: `Invalid chart configuration: ${errorMessage(e)}`,
        cls: CSS.error,
      });
      return;
    }

    if (!config.folder) {
      el.createEl("p", {
        text: `Missing required field: add folder: "path/to/folder" to the chart configuration.`,
        cls: CSS.error,
      });
      return;
    }

    if (config.properties.length === 0 || !config.properties[0]) {
      el.createEl("p", {
        text: `Missing required field: add property: "name" to the chart configuration.`,
        cls: CSS.error,
      });
      return;
    }

    const container = el.createDiv({ cls: CSS.canvasContainer });
    const limitOverride = true; // embedded codeblocks always load all files

    const render = async (): Promise<boolean> => {
      try {
        // For heatmap, collect the full year's data; for distribution, collect all notes.
        const collectConfig = config.type === "heatmap"
          ? {
              ...config,
              range: {
                from: `${config.heatmapYear ?? new Date().getFullYear()}-01-01`,
                to: `${config.heatmapYear ?? new Date().getFullYear()}-12-31`,
              },
            }
          : DISTRIBUTION_TYPES.includes(config.type)
          ? { ...config, range: { preset: "all" as RangePreset } }
          : config;
        // Line/bar go through collectForSeries so a text property renders as a frequency
        // chart here exactly as it does in the sidebar, instead of reporting an empty
        // time range for notes that carry no date at all.
        const isSeries =
          config.type !== "heatmap" && !DISTRIBUTION_TYPES.includes(config.type);
        const datasets = isSeries
          ? (await this.collector.collectForSeries(collectConfig, limitOverride)).datasets
          : await this.collector.collectDatasets(collectConfig, limitOverride);
        const hasData = datasets.some((d) => d.points.length > 0);
        if (!hasData && config.type !== "heatmap") {
          container.empty();
          container.createEl("p", {
            text: this.collector.explainEmptyResult(config),
            cls: CSS.embedNoData,
          });
          return false;
        }

        const prev = this.renderers.get(el);
        if (prev) {
          prev.destroy();
          container.empty();
        }

        const renderer = new ChartRenderer(container, true);
        await renderer.render(config, datasets);
        renderer.updateAriaLabel(config);
        this.renderers.set(el, renderer);
        return true;
      } catch (e) {
        container.empty();
        container.createEl("p", {
          text: `Property Charts: ${errorMessage(e)}`,
          cls: CSS.error,
        });
        return false;
      }
    };

    // Store the render callback so scheduleRefreshAll can re-render (not just destroy)
    this.refreshCallbacks.set(el, { folder: config.folder, refresh: render });

    const rendered = await render();

    // If MetadataCache wasn't ready yet, retry once when it resolves
    if (!rendered) {
      const ref = this.app.metadataCache.on("resolved", async () => {
        this.app.metadataCache.offref(ref);
        await render();
      });
      child.registerEvent(ref);
    }
  }

  // Re-render all embedded charts with fresh data (called on vault changes)
  readonly scheduleRefreshAll = debounce(async (changedFilePath?: string) => {
    const toRefresh: Array<() => Promise<boolean>> = [];
    for (const [el, entry] of this.refreshCallbacks) {
      // Detached blocks (e.g. scrolled out of a virtualized reading view) are cleaned
      // up by their MarkdownRenderChild; just skip them here.
      if (!el.isConnected) continue;
      if (changedFilePath) {
        const prefix = entry.folder === "/" ? "" : entry.folder + "/";
        if (!changedFilePath.startsWith(prefix)) continue;
      }
      toRefresh.push(entry.refresh);
    }
    await Promise.all(toRefresh.map((refresh) => refresh()));
  }, 500, true);

  buildConfig(raw: CodeBlockConfig): ChartConfig {
    const properties = toStringList(raw.property);

    const rawColors = toStringList(raw.colors);
    const badColor = rawColors.find((color) => !isValidColor(color));
    if (badColor !== undefined) {
      throw new Error(
        `Invalid color "${badColor}". Use a hex code (#6384FF), an rgb()/hsl() value or a CSS color name.`
      );
    }

    const rawType = raw.type ?? this.settings.defaultChartType;
    if (!isChartType(rawType)) {
      throw new Error(
        `Unknown chart type "${toDisplayString(rawType)}". Must be one of: ${ALL_CHART_TYPES.join(", ")}`
      );
    }
    const type = rawType;

    // `year` only has meaning for heatmaps. Rejecting it elsewhere is better than
    // accepting a value that is then silently dropped. Keyed on the key's presence,
    // not its value: a bare `year:` parses to null but still signals intent.
    const hasYear = Object.prototype.hasOwnProperty.call(raw, "year");
    if (hasYear && type !== "heatmap") {
      throw new Error(`"year" only applies to heatmaps, not to the "${type}" chart type.`);
    }
    const heatmapYear = this.parseYear(raw.year);

    // A heatmap always shows one full year, so without an explicit `range:` the year
    // itself is the range. Otherwise the default preset (e.g. 90d) would dim every
    // cell outside the last 90 days.
    const hasRange = raw.range !== undefined && raw.range !== null;
    const range: ChartConfig["range"] =
      !hasRange && type === "heatmap"
        ? { from: `${heatmapYear}-01-01`, to: `${heatmapYear}-12-31` }
        : this.parseRange(raw.range);

    // For distribution types, colors map to segments (not to datasets), so preserve all
    // raw colors. For other types, map 1:1 to properties.
    const colors = DISTRIBUTION_TYPES.includes(type) && rawColors.length > 0
      ? rawColors
      : properties.map((_, i) => rawColors[i] ?? CHART_COLORS_HEX[i % CHART_COLORS_HEX.length]);

    return {
      type,
      folder: normalizeFolderPath(
        raw.folder === undefined || raw.folder === null
          ? this.settings.defaultFolder
          : toDisplayString(raw.folder)
      ),
      properties,
      colors,
      dateFormat: this.sanitizeDateFormat(
        raw.dateFormat === undefined || raw.dateFormat === null
          ? this.settings.defaultDateFormat
          : toDisplayString(raw.dateFormat)
      ),
      range,
      heatmapYear,
    };
  }

  private parseYear(year: unknown): number {
    if (year === undefined || year === null) return new Date().getFullYear();
    const parsed = typeof year === "number" ? year : Number(toDisplayString(year));
    if (!Number.isInteger(parsed) || parsed < 1000 || parsed > 9999) {
      throw new Error(`Invalid year "${toDisplayString(year)}". Expected a four-digit year.`);
    }
    return parsed;
  }

  private sanitizeDateFormat(format: string): string {
    // Allow only moment.js format tokens and common separators; reject anything else
    // to prevent ReDoS via crafted format strings applied to every vault filename.
    if (/^[YMDHhmsAaZXxwWQeELNkodDgG[\] ./:_-]+$/.test(format)) return format;
    throw new Error(`Invalid dateFormat "${format}". Only moment.js tokens and separators (./:_-) are allowed.`);
  }

  parseRange(range?: unknown): ChartConfig["range"] {
    if (range === undefined || range === null) return { preset: this.settings.defaultRange };
    const rangeStr = toDisplayString(range);

    if (isRangePreset(rangeStr)) {
      return { preset: rangeStr };
    }

    // Custom range: "YYYY-MM-DD:YYYY-MM-DD"
    const parts = rangeStr.split(":");
    if (parts.length === 2) {
      const fromDate = new Date(parts[0]);
      const toDate = new Date(parts[1]);
      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        throw new Error(`Invalid dates in range "${rangeStr}". Format: YYYY-MM-DD:YYYY-MM-DD`);
      }
      const from = parts[0] <= parts[1] ? parts[0] : parts[1];
      const to = parts[0] <= parts[1] ? parts[1] : parts[0];
      return { from, to };
    }

    throw new Error(`Invalid range "${rangeStr}". Valid values: 7d · 30d · 90d · all · YYYY-MM-DD:YYYY-MM-DD`);
  }
}

