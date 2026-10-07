import { ItemView, WorkspaceLeaf, debounce } from "obsidian";
import { ChartConfig, Dataset, CHART_COLORS_HEX, CSS, CSS_VARS, DISTRIBUTION_TYPES, PluginSettings, RangePreset, stripWikiLinks } from "./types";
import { computeHeatmapDimensions, HEATMAP_WRAPPER_W } from "./HeatmapRenderer";
import { DataCollector } from "./DataCollector";
import { ChartRenderer } from "./ChartRenderer";
import { CODE_BLOCK_LANGUAGE } from "./CodeBlockProcessor";
import {
  buildControls,
  populateFolderSelect,
  rebuildPropertySelects,
  updateHeatmapButton,
  updateDistributionButtons,
  ControlRefs,
} from "./ChartViewControls";

export const VIEW_TYPE_CHART = "property-charts-view";

const DEFAULT_CHART_HEIGHT = "300px";

export class ChartView extends ItemView {
  private config: ChartConfig;
  private renderer: ChartRenderer | null = null;
  private collector: DataCollector;
  private chartContainer: HTMLElement;
  private controlRefs: ControlRefs | null = null;
  private datasets: string[] = [""];
  private heatmapYear: number = new Date().getFullYear();
  private yearNavContainer: HTMLElement | null = null;
  private segmentColorSection: HTMLElement | null = null;
  private segmentLabels: string[] = [];
  private limitOverride = false;
  private limitBanner: HTMLElement | null = null;
  private bannerContainer: HTMLElement;
  private emptyStateEl: HTMLElement;

  constructor(leaf: WorkspaceLeaf, private settings: PluginSettings) {
    super(leaf);
    this.collector = new DataCollector(this.app, settings);
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
  getFolder(): string { return this.config.folder; }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.addClass(CSS.view);

    // Settings area: scrolls internally when many datasets are added
    const scrollArea = root.createDiv({ cls: CSS.scrollArea });

    this.controlRefs = buildControls(scrollArea, this.config, this.datasets, this.collector, {
      onRefresh: () => this.refresh(),
      onRebuildPropertySelects: () => this.rebuildPropertySelects(),
      onReset: () => this.resetConfig(),
    });
    this.rebuildPropertySelects();

    // Segment color section – populated dynamically when a distribution type is active.
    this.segmentColorSection = scrollArea.createDiv({ cls: CSS.section });
    this.segmentColorSection.hide();

    // Button directly below settings, same horizontal inset as sections
    const actionsBar = root.createDiv({ cls: CSS.actions });
    const copyBtn = actionsBar.createEl("button", { text: "Copy as codeblock", cls: CSS.copyBtn });
    copyBtn.onclick = () => this.copyCodeblock(copyBtn);

    // Year navigator for heatmap (hidden when type is not heatmap)
    this.yearNavContainer = root.createDiv({ cls: CSS.yearNav });
    this.yearNavContainer.hide();
    const prevYearBtn = this.yearNavContainer.createEl("button", { text: "←", cls: CSS.toggleBtn });
    prevYearBtn.setAttribute("aria-label", "Previous year");
    const yearLabel = this.yearNavContainer.createSpan();
    yearLabel.setText(String(this.heatmapYear));
    const nextYearBtn = this.yearNavContainer.createEl("button", { text: "→", cls: CSS.toggleBtn });
    nextYearBtn.setAttribute("aria-label", "Next year");
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

    // Slot for empty-state guidance (no folder / no property selected)
    this.emptyStateEl = root.createDiv({ cls: CSS.noDataMsg });
    this.emptyStateEl.hide();

    // Banner slot above the chart (shown when file limit is exceeded)
    this.bannerContainer = root.createDiv();

    // Chart below button with a fixed height
    this.chartContainer = root.createDiv({ cls: CSS.canvasContainer });
    this.chartContainer.setCssProps({ [CSS_VARS.containerHeight]: DEFAULT_CHART_HEIGHT });

    this.registerEvent(
      this.app.metadataCache.on("resolved", () => {
        if (this.config.folder) this.rebuildPropertySelects();
      })
    );

    await this.refresh();
  }

  async onClose(): Promise<void> {
    this.renderer?.destroy();
  }

  readonly scheduleRefresh = debounce(async () => {
    await this.refresh();
  }, 500, true);

  onSettingsChanged(settings: PluginSettings): void {
    this.settings = settings;
    this.collector.updateSettings(settings);
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
        onReset: () => this.resetConfig(),
      }
    );
    const activeCount = this.config.properties.filter(Boolean).length;
    updateHeatmapButton(this.controlRefs, activeCount);
    updateDistributionButtons(this.controlRefs, activeCount, this.config.type, activeCount > 0);
  }

  private resetConfig(): void {
    this.config.type = this.settings.defaultChartType;
    this.config.properties = [""];
    this.config.colors = [CHART_COLORS_HEX[0]];
    this.config.dateFormat = this.settings.defaultDateFormat;
    this.config.range = { preset: this.settings.defaultRange };
    this.datasets.length = 0;
    this.datasets.push("");
    this.heatmapYear = new Date().getFullYear();
    this.limitOverride = false;
    this.rebuildPropertySelects();
    void this.refresh();
  }

  private async copyCodeblock(btn: HTMLButtonElement): Promise<void> {
    const activeIndices = this.config.properties
      .map((p, i) => (p ? i : -1))
      .filter((i) => i >= 0);
    const activeProps = activeIndices.map((i) => this.config.properties[i]);

    // For distribution types, export per-segment colors instead of per-dataset colors.
    const isDistribution = DISTRIBUTION_TYPES.includes(this.config.type);
    const exportColors = isDistribution
      ? this.segmentLabels.map(
          (_, i) => this.config.colors[i] ?? CHART_COLORS_HEX[i % CHART_COLORS_HEX.length]
        )
      : activeIndices.map((i) => this.config.colors[i]);

    const propYaml =
      activeProps.length === 1
        ? `property: ${yamlQuote(activeProps[0])}`
        : `property:\n${activeProps.map((p) => `  - ${yamlQuote(p)}`).join("\n")}`;

    const colorsYaml =
      exportColors.length === 1
        ? `colors: "${exportColors[0]}"`
        : `colors:\n${exportColors.map((c) => `  - "${c}"`).join("\n")}`;

    let rangeYaml = "";
    if (!DISTRIBUTION_TYPES.includes(this.config.type)) {
      if (this.config.range.preset) {
        rangeYaml = `range: ${this.config.range.preset}`;
      } else if (this.config.range.from && this.config.range.to) {
        rangeYaml = `range: ${this.config.range.from}:${this.config.range.to}`;
      }
    }

    const yearYaml = this.config.type === "heatmap"
      ? `year: ${this.heatmapYear}`
      : "";

    const block = [
      "```" + CODE_BLOCK_LANGUAGE,
      `type: ${this.config.type}`,
      `folder: ${yamlQuote(this.config.folder)}`,
      propYaml,
      colorsYaml,
      `dateFormat: ${this.config.dateFormat}`,
      rangeYaml,
      yearYaml,
      "```",
    ].filter(Boolean).join("\n");

    try {
      await navigator.clipboard.writeText(block);
      btn.setText("Copied!");
      btn.addClass("copied");
      window.setTimeout(() => {
        btn.setText("Copy as codeblock");
        btn.removeClass("copied");
      }, 2000);
    } catch {
      btn.setText("Failed – check clipboard permissions");
      window.setTimeout(() => btn.setText("Copy as codeblock"), 3000);
    }
  }

  async refresh(): Promise<void> {
    if (!this.chartContainer) return;

    const activeProperties = this.config.properties.filter(Boolean);
    const isHeatmap = this.config.type === "heatmap";
    const isDistribution = DISTRIBUTION_TYPES.includes(this.config.type);
    const hasActiveProperty = activeProperties.length > 0;

    this.syncEarlyControlState(isHeatmap, hasActiveProperty);
    if (!hasActiveProperty || !this.config.folder) {
      this.rebuildSegmentColorSection([]);
      this.renderer?.destroy();
      this.renderer = null;
      this.chartContainer.empty();
      this.chartContainer.hide();
      this.bannerContainer.empty();
      this.limitBanner = null;
      const emptyMsg = !this.config.folder
        ? "Select a folder to get started."
        : "Select a property to create a chart.";
      this.emptyStateEl.setText(emptyMsg);
      this.emptyStateEl.show();
      if (this.controlRefs?.dataHint) {
        this.controlRefs.dataHint.setText(emptyMsg);
        this.controlRefs.dataHint.show();
      }
      return;
    }

    this.controlRefs?.dataHint?.hide();

    this.emptyStateEl.hide();
    this.chartContainer.show();

    const height = isHeatmap
      ? `${computeHeatmapDimensions(HEATMAP_WRAPPER_W).totalH}px`
      : DEFAULT_CHART_HEIGHT;
    this.chartContainer.setCssProps({ [CSS_VARS.containerHeight]: height });

    this.chartContainer.addClass("is-loading");
    this.chartContainer.setAttribute("aria-busy", "true");
    try {
      const configToRender: ChartConfig = { ...this.config, properties: activeProperties };
      const datasets = await this.collectChartData(configToRender, isHeatmap, isDistribution);
      this.syncControlState(datasets, configToRender, isHeatmap, isDistribution);
      await this.renderChartData(configToRender, datasets, isHeatmap);
    } catch (e) {
      console.error("Property Charts: render error", e);
      this.chartContainer.empty();
      this.chartContainer.createEl("p", {
        text: `Failed to render chart: ${(e as Error).message}`,
        cls: CSS.error,
      });
    } finally {
      this.chartContainer.removeClass("is-loading");
      this.chartContainer.removeAttribute("aria-busy");
    }
  }

  private syncEarlyControlState(isHeatmap: boolean, hasActiveProperty: boolean): void {
    this.yearNavContainer?.toggle(isHeatmap);
    if (this.controlRefs) {
      const activeCount = this.config.properties.filter(Boolean).length;
      updateHeatmapButton(this.controlRefs, activeCount);
      updateDistributionButtons(this.controlRefs, activeCount, this.config.type, hasActiveProperty);
    }
  }

  private async collectChartData(
    configToRender: ChartConfig,
    isHeatmap: boolean,
    isDistribution: boolean,
  ): Promise<Dataset[]> {
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
    } else if (isDistribution) {
      collectConfig = { ...configToRender, range: { preset: "all" as RangePreset } };
    }

    let datasets = await this.collector.collectDatasets(collectConfig, this.limitOverride);

    // For line/bar: if the range filter produced no data, try a full (unfiltered)
    // collection to see whether the property is text-typed. If it is, use that data
    // for the frequency chart. If it is numeric, keep the empty result.
    if (!isHeatmap && !isDistribution && !datasets.some((d) => d.points.length > 0)) {
      const fallback = await this.collector.collectDatasets({
        ...configToRender,
        range: { preset: "all" as RangePreset },
      });
      if (
        fallback.some((d) => d.points.length > 0) &&
        fallback.every((d) => d.valueType === "text")
      ) {
        datasets = fallback;
      }
    }

    return datasets;
  }

  private syncControlState(
    datasets: Dataset[],
    configToRender: ChartConfig,
    isHeatmap: boolean,
    isDistribution: boolean,
  ): void {
    const allPropsAreText =
      !isHeatmap && !isDistribution &&
      datasets.length > 0 &&
      datasets.every((d) => d.valueType === "text");

    const isTextProperty =
      datasets.some((d) => d.points.length > 0) &&
      datasets.every((d) => d.valueType === "text");

    const hasAnyPoints = datasets.some((d) => d.points.length > 0);
    const hasDates =
      !isTextProperty &&
      (!hasAnyPoints || datasets.some((d) => d.points.some((p) => p.date !== null)));

    if (isDistribution && datasets[0]) {
      const seen = new Set<string>();
      for (const point of datasets[0].points) {
        if (point.rawValue === null || point.rawValue === undefined) continue;
        const vals = Array.isArray(point.rawValue)
          ? (point.rawValue as unknown[]).map(String)
          : [String(point.rawValue)];
        for (const val of vals) seen.add(val);
      }
      this.rebuildSegmentColorSection([...seen].sort().map(stripWikiLinks));
    } else {
      this.rebuildSegmentColorSection([]);
    }

    if (this.controlRefs) {
      const activeCount = this.config.properties.filter(Boolean).length;
      updateHeatmapButton(this.controlRefs, activeCount, isTextProperty, hasDates);
    }

    if (this.controlRefs?.rangeSection && !isHeatmap && !isDistribution) {
      this.controlRefs.rangeSection.toggle(!allPropsAreText);
    }

    if (this.controlRefs?.dataHint) {
      const hint = this.controlRefs.dataHint;
      if (isHeatmap && allPropsAreText) {
        hint.setText("Heatmap requires numeric or boolean values. Text values are not supported.");
        hint.show();
      } else if (!isHeatmap && !isDistribution && allPropsAreText) {
        hint.setText("Text values detected — showing as frequency chart instead of time series.");
        hint.show();
      } else {
        hint.hide();
      }
    }
  }

  private async renderChartData(
    configToRender: ChartConfig,
    datasets: Dataset[],
    isHeatmap: boolean,
  ): Promise<void> {
    this.renderer?.destroy();
    this.renderer = null;
    this.chartContainer.empty();

    const hasData = datasets.some((d) => d.points.length > 0);
    if (!hasData && !isHeatmap) {
      this.chartContainer.createEl("p", {
        text: `No data found. Check the time range and that your date format (${configToRender.dateFormat}) matches your filenames.`,
        cls: CSS.noDataMsg,
      });
      // The renderer was already destroyed and reset to null above, so the next
      // refresh() starts from a clean state.
      return;
    }

    this.renderer = new ChartRenderer(this.chartContainer);
    const renderConfig = isHeatmap
      ? { ...configToRender, heatmapYear: this.heatmapYear }
      : configToRender;
    await this.renderer.render(renderConfig, datasets);
    this.renderer.updateAriaLabel(renderConfig);

    this.bannerContainer.empty();
    this.limitBanner = null;
    const anyTruncated = datasets.find((d) => d.truncated);
    const totalCount = datasets.find((d) => d.totalCount !== undefined)?.totalCount ?? 0;
    if (anyTruncated) {
      this.limitBanner = this.bannerContainer.createDiv();
      renderLimitStatusChip(this.limitBanner, "truncated", totalCount, this.settings.fileLimit, async () => {
        this.limitOverride = true;
        await this.refresh();
      });
    } else if (this.limitOverride && totalCount > 0) {
      this.limitBanner = this.bannerContainer.createDiv();
      renderLimitStatusChip(this.limitBanner, "overridden", totalCount, this.settings.fileLimit, async () => {
        this.limitOverride = false;
        await this.refresh();
      });
    }
  }

  private rebuildSegmentColorSection(labels: string[]): void {
    const section = this.segmentColorSection;
    if (!section) return;

    this.segmentLabels = labels;
    section.empty();

    if (labels.length === 0) {
      section.hide();
      return;
    }

    section.show();
    section.createDiv({ cls: CSS.sectionTitle, text: "Segment colors" });

    labels.forEach((label, i) => {
      const row = section.createDiv({ cls: CSS.row });

      const colorInput = row.createEl("input", { type: "color", cls: CSS.colorInput });
      colorInput.value =
        this.config.colors[i] ?? CHART_COLORS_HEX[i % CHART_COLORS_HEX.length];

      row.createEl("label", { text: label });

      // Use onchange only so the chart re-renders after the picker is closed,
      // preventing the picker from closing mid-selection.
      colorInput.onchange = async () => {
        this.config.colors[i] = colorInput.value;
        await this.refresh();
      };
    });
  }
}

function renderLimitStatusChip(
  container: HTMLElement,
  state: "truncated" | "overridden",
  totalCount: number,
  limit: number,
  onToggle: () => Promise<void>
): void {
  if (state === "truncated") {
    container.addClass("chart-plugin-limit-banner");
    container.createSpan({
      text: `${limit.toLocaleString()} of ${totalCount.toLocaleString()} files loaded.`,
    });
    const btn = container.createEl("button");
    btn.setText("Load all");
    btn.onclick = () => onToggle();
  } else {
    container.addClass("chart-plugin-limit-chip");
    container.createSpan({
      text: `All ${totalCount.toLocaleString()} files loaded.`,
    });
    const btn = container.createEl("button");
    btn.setText("Apply limit");
    btn.onclick = () => onToggle();
  }
}

function yamlQuote(value: string): string {
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
  }"`;
}
