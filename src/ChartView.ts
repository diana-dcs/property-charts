import { ItemView, WorkspaceLeaf, debounce } from "obsidian";
import { ChartConfig, CHART_COLORS_HEX, CSS, PluginSettings } from "./types";
import { computeHeatmapDimensions, HEATMAP_WRAPPER_W } from "./HeatmapRenderer";
import { DataCollector } from "./DataCollector";
import { ChartRenderer } from "./ChartRenderer";
import {
  buildControls,
  populateFolderSelect,
  rebuildPropertySelects,
  updateHeatmapButton,
  ControlRefs,
} from "./ChartViewControls";

export const VIEW_TYPE_CHART = "chart-plugin-view";

export class ChartView extends ItemView {
  private config: ChartConfig;
  private renderer: ChartRenderer | null = null;
  private collector: DataCollector;
  private chartContainer: HTMLElement;
  private controlRefs: ControlRefs | null = null;
  private datasets: string[] = [""];
  private heatmapYear: number = new Date().getFullYear();
  private yearNavContainer: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, private settings: PluginSettings) {
    super(leaf);
    this.collector = new DataCollector(this.app);
    this.config = {
      type: settings.defaultChartType,
      folder: settings.defaultFolder,
      properties: [""],
      colors: [CHART_COLORS_HEX[0]],
      dateFormat: settings.defaultDateFormat,
      range: { preset: settings.defaultRange },
    };
  }

  getViewType(): string { return VIEW_TYPE_CHART; }
  getDisplayText(): string { return "Chart"; }
  getIcon(): string { return "bar-chart-2"; }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.addClass(CSS.view);

    // Settings area: scrolls internally when many datasets are added
    const scrollArea = root.createDiv();
    scrollArea.style.overflowY = "auto";
    scrollArea.style.maxHeight = "45vh";

    this.controlRefs = buildControls(scrollArea, this.config, this.datasets, this.collector, {
      onRefresh: () => this.refresh(),
      onRebuildPropertySelects: () => this.rebuildPropertySelects(),
      onCopyCodeblock: (btn) => this.copyCodeblock(btn),
    });
    this.rebuildPropertySelects();

    // Button directly below settings, same horizontal inset as sections
    const actionsBar = root.createDiv({ cls: CSS.actions });
    const copyBtn = actionsBar.createEl("button", { text: "Copy as codeblock", cls: CSS.copyBtn });
    copyBtn.onclick = () => this.copyCodeblock(copyBtn);

    // Year navigator for heatmap (hidden when type is not heatmap)
    this.yearNavContainer = root.createDiv();
    this.yearNavContainer.style.cssText =
      "display:none; align-items:center; justify-content:center; gap:0.5em; padding:4px 0;";
    const prevYearBtn = this.yearNavContainer.createEl("button", { text: "←", cls: CSS.toggleBtn });
    const yearLabel = this.yearNavContainer.createEl("span");
    yearLabel.style.cssText = "min-width:4ch; text-align:center; font-weight:500;";
    yearLabel.setText(String(this.heatmapYear));
    const nextYearBtn = this.yearNavContainer.createEl("button", { text: "→", cls: CSS.toggleBtn });
    prevYearBtn.onclick = async () => {
      this.heatmapYear--;
      yearLabel.setText(String(this.heatmapYear));
      await this.refresh();
    };
    nextYearBtn.onclick = async () => {
      this.heatmapYear++;
      yearLabel.setText(String(this.heatmapYear));
      await this.refresh();
    };

    // Chart below button with a fixed height
    this.chartContainer = root.createDiv({ cls: CSS.canvasContainer });
    this.chartContainer.style.height = "300px";
    this.renderer = new ChartRenderer(this.chartContainer);

    this.registerEvent(
      this.app.metadataCache.on("resolved", () => {
        if (this.config.folder) this.rebuildPropertySelects();
      })
    );

    if (this.config.folder && this.config.properties[0]) {
      await this.refresh();
    }
  }

  async onClose(): Promise<void> {
    this.renderer?.destroy();
  }

  readonly scheduleRefresh = debounce(async () => {
    await this.refresh();
  }, 500, true);

  onSettingsChanged(settings: PluginSettings): void {
    this.settings = settings;
    if (!this.config.folder && settings.defaultFolder) {
      this.config.folder = settings.defaultFolder;
      if (this.controlRefs) {
        populateFolderSelect(this.controlRefs.folderSelect, this.config, this.collector);
        this.rebuildPropertySelects();
      }
      this.scheduleRefresh();
    }
  }

  private rebuildPropertySelects(): void {
    if (!this.controlRefs) return;
    rebuildPropertySelects(
      this.controlRefs.propSection,
      this.config,
      this.collector,
      this.datasets,
      {
        onRefresh: () => this.refresh(),
        onRebuildPropertySelects: () => this.rebuildPropertySelects(),
        onCopyCodeblock: (btn) => this.copyCodeblock(btn),
      }
    );
    const activeCount = this.config.properties.filter(Boolean).length;
    updateHeatmapButton(this.controlRefs, activeCount, this.config.type);
  }

  private copyCodeblock(btn: HTMLButtonElement): void {
    const activeIndices = this.config.properties
      .map((p, i) => (p ? i : -1))
      .filter((i) => i >= 0);
    const activeProps = activeIndices.map((i) => this.config.properties[i]);
    const activeColors = activeIndices.map((i) => this.config.colors[i]);

    const propYaml =
      activeProps.length === 1
        ? `property: ${activeProps[0]}`
        : `property:\n${activeProps.map((p) => `  - ${p}`).join("\n")}`;

    const colorsYaml =
      activeColors.length === 1
        ? `colors: "${activeColors[0]}"`
        : `colors:\n${activeColors.map((c) => `  - "${c}"`).join("\n")}`;

    let rangeYaml = "";
    if (this.config.range.preset) {
      rangeYaml = `range: ${this.config.range.preset}`;
    } else if (this.config.range.from && this.config.range.to) {
      rangeYaml = `range: ${this.config.range.from}:${this.config.range.to}`;
    }

    const yearYaml = this.config.type === "heatmap"
      ? `year: ${this.heatmapYear}`
      : "";

    const block = [
      "```chart",
      `type: ${this.config.type}`,
      `folder: ${this.config.folder}`,
      propYaml,
      colorsYaml,
      `dateFormat: ${this.config.dateFormat}`,
      rangeYaml,
      yearYaml,
      "```",
    ].filter(Boolean).join("\n");

    navigator.clipboard.writeText(block).then(() => {
      btn.setText("Copied!");
      btn.addClass("copied");
      setTimeout(() => {
        btn.setText("Copy as codeblock");
        btn.removeClass("copied");
      }, 2000);
    }).catch(() => {
      btn.setText("Failed – check clipboard permissions");
      setTimeout(() => btn.setText("Copy as codeblock"), 3000);
    });
  }

  async refresh(): Promise<void> {
    if (!this.renderer || !this.config.folder) return;
    const activeProperties = this.config.properties.filter(Boolean);
    if (activeProperties.length === 0) return;

    const isHeatmap = this.config.type === "heatmap";
    if (this.yearNavContainer) {
      this.yearNavContainer.style.display = isHeatmap ? "flex" : "none";
    }
    // Pre-size the container so there's no height jump during async data collection.
    if (isHeatmap) {
      const { totalH } = computeHeatmapDimensions(HEATMAP_WRAPPER_W);
      this.chartContainer.style.height = `${totalH}px`;
    } else {
      this.chartContainer.style.height = "300px";
    }
    // Keep hint in sync when type switches (e.g. via codeblock re-render)
    if (this.controlRefs) {
      const activeCount = this.config.properties.filter(Boolean).length;
      updateHeatmapButton(this.controlRefs, activeCount, this.config.type);
    }

    try {
      const configToRender: ChartConfig = { ...this.config, properties: activeProperties };

      // For heatmap, collect the full year's data; range is used only for graying
      let collectConfig = configToRender;
      if (isHeatmap) {
        collectConfig = {
          ...configToRender,
          heatmapYear: this.heatmapYear,
          range: {
            from: `${this.heatmapYear}-01-01`,
            to: `${this.heatmapYear}-12-31`,
          },
        };
      }

      const datasets = await this.collector.collectDatasets(collectConfig);
      this.renderer.destroy();
      this.chartContainer.empty();

      const hasData = datasets.some((d) => d.points.length > 0);
      if (!hasData && !isHeatmap) {
        const msg = this.chartContainer.createEl("p", {
          text: `No data found. Check the time range and that your date format (${configToRender.dateFormat}) matches your filenames.`,
        });
        msg.style.cssText = "color: var(--text-muted); padding: 1em; font-size: 0.9em;";
        this.renderer = new ChartRenderer(this.chartContainer);
        return;
      }

      this.renderer = new ChartRenderer(this.chartContainer);
      const renderConfig = isHeatmap
        ? { ...configToRender, heatmapYear: this.heatmapYear }
        : configToRender;
      await this.renderer.render(renderConfig, datasets);
    } catch (e) {
      console.error("Chart Plugin: render error", e);
    }
  }
}
