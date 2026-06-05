import { App, MarkdownPostProcessorContext, debounce } from "obsidian";
import * as yaml from "js-yaml";
import { ChartConfig, ChartType, CHART_COLORS_HEX, CSS, RangePreset, PluginSettings } from "./types";
import { DataCollector } from "./DataCollector";
import { ChartRenderer } from "./ChartRenderer";

interface CodeBlockConfig {
  type?: ChartType;
  folder?: string;
  property?: string | string[];
  colors?: string | string[];
  dateFormat?: string;
  range?: string;
  year?: number;
}

export class CodeBlockProcessor {
  private collector: DataCollector;
  private renderers: Map<HTMLElement, ChartRenderer> = new Map();
  // Stored so scheduleRefreshAll can re-render with fresh data
  private refreshCallbacks: Map<HTMLElement, () => Promise<boolean>> = new Map();

  constructor(private app: App, private settings: PluginSettings) {
    this.collector = new DataCollector(app);
    this.app.vault.on("delete", () => this.pruneStaleEntries());
  }

  private pruneStaleEntries(): void {
    for (const [el] of this.refreshCallbacks) {
      if (!document.contains(el)) {
        this.renderers.get(el)?.destroy();
        this.renderers.delete(el);
        this.refreshCallbacks.delete(el);
      }
    }
  }

  async process(
    source: string,
    el: HTMLElement,
    _ctx: MarkdownPostProcessorContext
  ): Promise<void> {
    el.addClass(CSS.embed);

    let raw: CodeBlockConfig;
    try {
      const parsed = yaml.load(source);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("Chart config must be a YAML mapping");
      }
      raw = parsed as CodeBlockConfig;
    } catch (e) {
      el.createEl("p", {
        text: `Chart Plugin: Invalid YAML — ${(e as Error).message}`,
        cls: CSS.error,
      });
      return;
    }

    const config = this.buildConfig(raw);

    if (!config.folder) {
      el.createEl("p", {
        text: "Chart Plugin: 'folder' is required.",
        cls: CSS.error,
      });
      return;
    }

    if (config.properties.length === 0 || !config.properties[0]) {
      el.createEl("p", {
        text: "Chart Plugin: 'property' is required.",
        cls: CSS.error,
      });
      return;
    }

    const container = el.createDiv({ cls: CSS.canvasContainer });

    const render = async (): Promise<boolean> => {
      try {
        // For heatmap, collect the full year's data; range is used only for cell graying
        const collectConfig = config.type === "heatmap"
          ? {
              ...config,
              range: {
                from: `${config.heatmapYear ?? new Date().getFullYear()}-01-01`,
                to: `${config.heatmapYear ?? new Date().getFullYear()}-12-31`,
              },
            }
          : config;
        const datasets = await this.collector.collectDatasets(collectConfig);
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
    this.refreshCallbacks.set(el, render);

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
  readonly scheduleRefreshAll = debounce(async () => {
    for (const [el, refresh] of this.refreshCallbacks) {
      // Skip stale entries where the element is no longer in the DOM
      if (!document.contains(el)) {
        this.refreshCallbacks.delete(el);
        this.renderers.get(el)?.destroy();
        this.renderers.delete(el);
        continue;
      }
      await refresh();
    }
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
    const colors = properties.map(
      (_, i) => rawColors[i] ?? CHART_COLORS_HEX[i % CHART_COLORS_HEX.length]
    );

    const type: ChartType = (raw.type ?? this.settings.defaultChartType) as ChartType;

    return {
      type,
      folder: raw.folder ?? this.settings.defaultFolder,
      properties,
      colors,
      dateFormat: raw.dateFormat ?? this.settings.defaultDateFormat,
      range,
      heatmapYear: raw.year ?? new Date().getFullYear(),
    };
  }

  parseRange(range?: string): ChartConfig["range"] {
    if (!range) return { preset: this.settings.defaultRange };

    const presets: RangePreset[] = ["7d", "30d", "90d", "all"];
    if (presets.includes(range as RangePreset)) {
      return { preset: range as RangePreset };
    }

    // Custom range: "YYYY-MM-DD:YYYY-MM-DD"
    const parts = range.split(":");
    if (parts.length === 2) {
      return { from: parts[0], to: parts[1] };
    }

    return { preset: "30d" };
  }
}
