import { App, MarkdownPostProcessorContext, debounce } from "obsidian";
import * as yaml from "js-yaml";
import { ChartConfig, ChartType, CHART_COLORS_HEX, CSS, DISTRIBUTION_TYPES, ALL_CHART_TYPES, RangePreset, PluginSettings } from "./types";
import { DataCollector } from "./DataCollector";
import { ChartRenderer } from "./ChartRenderer";

interface CodeBlockConfig {
  type?: ChartType;
  folder?: string;
  property?: string | string[];
  colors?: string | string[];
  dateFormat?: string;
  range?: unknown;
  year?: number;
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

  pruneStaleEntries(): void {
    for (const [el] of this.refreshCallbacks) {
      if (!document.contains(el)) {
        this.renderers.get(el)?.destroy();
        this.renderers.delete(el);
        this.refreshCallbacks.delete(el);
      }
    }
  }

  clearPropertyCache(filePath?: string): void {
    this.collector.clearPropertyCache(filePath);
  }

  async process(
    source: string,
    el: HTMLElement,
    _ctx: MarkdownPostProcessorContext
  ): Promise<void> {
    el.addClass(CSS.embed);

    let raw: CodeBlockConfig;
    try {
      if (source.length > 10_000) {
        throw new Error("Config exceeds 10 000 character limit");
      }
      const parsed = yaml.load(source, { schema: yaml.JSON_SCHEMA });
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("Chart config must be a YAML mapping");
      }
      raw = parsed as CodeBlockConfig;
    } catch (e) {
      el.createEl("p", {
        text: `Ungültige YAML-Konfiguration: ${(e as Error).message} — Überprüfe Einrückung und Anführungszeichen.`,
        cls: CSS.error,
      });
      return;
    }

    const config = this.buildConfig(raw);

    if (!config.folder) {
      el.createEl("p", {
        text: `Pflichtfeld fehlt: Füge folder: "Pfad/zum/Ordner" zur Chart-Konfiguration hinzu.`,
        cls: CSS.error,
      });
      return;
    }

    if (config.properties.length === 0 || !config.properties[0]) {
      el.createEl("p", {
        text: `Pflichtfeld fehlt: Füge property: "eigenschaft" zur Chart-Konfiguration hinzu.`,
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
        const datasets = await this.collector.collectDatasets(collectConfig, limitOverride);
        const hasData = datasets.some((d) => d.points.length > 0);
        if (!hasData && config.type !== "heatmap") {
          container.empty();
          const msg = container.createEl("p", {
            text: `No data found for this time range. Try a wider range or check that your date format (${config.dateFormat}) matches your filenames.`,
          });
          msg.style.cssText = "color: var(--text-muted); padding: 1em; font-size: 0.9em; margin: 0;";
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
          text: `Chart Plugin: ${(e as Error).message}`,
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
        try {
          await render();
        } catch (e) {
          container.empty();
          container.createEl("p", {
            text: `Chart Plugin: ${(e as Error).message}`,
            cls: CSS.error,
          });
        }
      });
    }
  }

  // Re-render all embedded charts with fresh data (called on vault changes)
  readonly scheduleRefreshAll = debounce(async (changedFilePath?: string) => {
    const toRefresh: Array<() => Promise<boolean>> = [];
    for (const [el, entry] of this.refreshCallbacks) {
      if (!document.contains(el)) {
        this.refreshCallbacks.delete(el);
        this.renderers.get(el)?.destroy();
        this.renderers.delete(el);
        continue;
      }
      if (changedFilePath) {
        const prefix = entry.folder === "/" ? "" : entry.folder + "/";
        if (!changedFilePath.startsWith(prefix)) continue;
      }
      toRefresh.push(entry.refresh);
    }
    await Promise.all(toRefresh.map((refresh) => refresh()));
  }, 500, true);

  buildConfig(raw: CodeBlockConfig): ChartConfig {
    const properties = Array.isArray(raw.property)
      ? raw.property
      : raw.property
      ? [raw.property]
      : [];

    const range = this.parseRange(raw.range);

    const rawColors = Array.isArray(raw.colors)
      ? raw.colors
      : raw.colors
      ? [raw.colors]
      : [];

    const rawType = raw.type ?? this.settings.defaultChartType;
    if (!ALL_CHART_TYPES.includes(rawType as ChartType)) {
      throw new Error(`Unknown chart type "${rawType}". Must be one of: ${ALL_CHART_TYPES.join(", ")}`);
    }
    const type = rawType as ChartType;

    // For distribution types, colors map to segments (not to datasets), so preserve all
    // raw colors. For other types, map 1:1 to properties.
    const colors = DISTRIBUTION_TYPES.includes(type) && rawColors.length > 0
      ? rawColors
      : properties.map((_, i) => rawColors[i] ?? CHART_COLORS_HEX[i % CHART_COLORS_HEX.length]);

    return {
      type,
      folder: raw.folder ?? this.settings.defaultFolder,
      properties,
      colors,
      dateFormat: this.sanitizeDateFormat(raw.dateFormat ?? this.settings.defaultDateFormat),
      range,
      heatmapYear: raw.year ?? new Date().getFullYear(),
    };
  }

  private sanitizeDateFormat(format: string): string {
    // Allow only moment.js format tokens and common separators; reject anything else
    // to prevent ReDoS via crafted format strings applied to every vault filename.
    if (/^[YMDHhmsAaZXxwWQeELNkodDgG\[\] ./:_-]+$/.test(format)) return format;
    throw new Error(`Ungültiges dateFormat "${format}". Nur moment.js-Tokens und Trennzeichen (./:_-) sind erlaubt.`);
  }

  parseRange(range?: unknown): ChartConfig["range"] {
    if (range === undefined || range === null) return { preset: this.settings.defaultRange };
    const rangeStr = String(range);

    const presets: RangePreset[] = ["7d", "30d", "90d", "all"];
    if (presets.includes(rangeStr as RangePreset)) {
      return { preset: rangeStr as RangePreset };
    }

    // Custom range: "YYYY-MM-DD:YYYY-MM-DD"
    const parts = rangeStr.split(":");
    if (parts.length === 2) {
      const fromDate = new Date(parts[0]);
      const toDate = new Date(parts[1]);
      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        throw new Error(`Ungültige Daten im Bereich "${rangeStr}". Format: JJJJ-MM-TT:JJJJ-MM-TT`);
      }
      const from = parts[0] <= parts[1] ? parts[0] : parts[1];
      const to = parts[0] <= parts[1] ? parts[1] : parts[0];
      return { from, to };
    }

    throw new Error(`Ungültiger Bereich "${rangeStr}". Gültige Werte: 7d · 30d · 90d · all · JJJJ-MM-TT:JJJJ-MM-TT`);
  }
}

