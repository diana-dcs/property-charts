import { ItemView, WorkspaceLeaf, debounce } from "obsidian";
import { handle } from "./eventHandlers";
import { renderLimitBanner } from "./LimitBanner";
import { buildCodeblock } from "./codeblockExport";
import {
  ChartConfig,
  Dataset,
  CHART_COLORS_HEX,
  CSS,
  CSS_VARS,
  PluginSettings,
  colorAt,
  countValueFrequencies,
  errorMessage,
  isDistributionType,
  isTextDatasets,
  stripWikiLinks,
  yearRange,
} from "./types";
import { computeHeatmapDimensions, HEATMAP_WRAPPER_W } from "./HeatmapRenderer";
import { DataCollector } from "./DataCollector";
import { ChartRenderer } from "./ChartRenderer";
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

/** What the collected data allows, which decides which controls stay usable. */
interface DataShape {
  /** The property holds text, so it is drawn as a frequency chart and locks the heatmap. */
  isText: boolean;
  /** At least one note carries a readable date, without which a heatmap has no axis. */
  hasDates: boolean;
  /**
   * The range filter shaped the result. False for a text property drawn as a frequency
   * chart: the range controls then stay hidden and `range:` is left out on export.
   */
  rangeApplies: boolean;
}

/** The shape assumed before anything is known, which restricts no control. */
const PERMISSIVE_SHAPE: DataShape = { isText: false, hasDates: true, rangeApplies: true };

export class ChartView extends ItemView {
  private config: ChartConfig;
  private renderer: ChartRenderer | null = null;
  private collector: DataCollector;
  // Created in onOpen(), before any render path can reach them.
  private chartContainer!: HTMLElement;
  private controlRefs: ControlRefs | null = null;
  private heatmapYear: number = new Date().getFullYear();
  private yearNavContainer: HTMLElement | null = null;
  private segmentColorSection: HTMLElement | null = null;
  private segmentLabels: string[] = [];
  private limitOverride = false;
  /**
   * Last known shape of the selected data. Kept on the view so control updates triggered
   * outside a refresh (e.g. the metadata-cache "resolved" event) don't reset the heatmap
   * button and its hint to the permissive defaults.
   */
  private shape: DataShape = PERMISSIVE_SHAPE;
  private limitBanner: HTMLElement | null = null;
  private bannerContainer!: HTMLElement;
  private emptyStateEl!: HTMLElement;

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

  /** Datasets with a property actually selected; the empty rows are placeholders. */
  private get activePropertyCount(): number {
    return this.config.properties.filter(Boolean).length;
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.addClass(CSS.view);

    // Settings area: scrolls internally when many datasets are added
    const scrollArea = root.createDiv({ cls: CSS.scrollArea });

    this.controlRefs = buildControls(scrollArea, this.collector, {
      getConfig: () => this.config,
      onConfigChange: (patch) => this.updateConfig(patch),
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
    copyBtn.onclick = handle(() => this.copyCodeblock(copyBtn));

    // Year navigator for heatmap (hidden when type is not heatmap)
    this.yearNavContainer = root.createDiv({ cls: CSS.yearNav });
    this.yearNavContainer.hide();
    const prevYearBtn = this.yearNavContainer.createEl("button", { text: "←", cls: CSS.toggleBtn });
    prevYearBtn.setAttribute("aria-label", "Previous year");
    const yearLabel = this.yearNavContainer.createSpan();
    yearLabel.setText(String(this.heatmapYear));
    const nextYearBtn = this.yearNavContainer.createEl("button", { text: "→", cls: CSS.toggleBtn });
    nextYearBtn.setAttribute("aria-label", "Next year");
    prevYearBtn.onclick = handle(async () => {
      this.heatmapYear--;
      yearLabel.setText(String(this.heatmapYear));
      await this.refresh();
    });
    nextYearBtn.onclick = handle(async () => {
      this.heatmapYear++;
      yearLabel.setText(String(this.heatmapYear));
      await this.refresh();
    });

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

  onClose(): Promise<void> {
    this.renderer?.destroy();
    return Promise.resolve();
  }

  readonly scheduleRefresh = debounce(async () => {
    await this.refresh();
  }, 500, true);

  onSettingsChanged(settings: PluginSettings): void {
    this.settings = settings;
    this.collector.updateSettings(settings);
    if (!this.config.folder && settings.defaultFolder) {
      this.updateConfig({ folder: settings.defaultFolder });
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
      {
        getConfig: () => this.config,
        onConfigChange: (patch) => this.updateConfig(patch),
        onRefresh: () => this.refresh(),
        onRebuildPropertySelects: () => this.rebuildPropertySelects(),
        onReset: () => this.resetConfig(),
      }
    );
    const activeCount = this.activePropertyCount;
    updateHeatmapButton(this.controlRefs, activeCount, this.shape.isText, this.shape.hasDates);
    updateDistributionButtons(
      this.controlRefs,
      activeCount,
      this.config.type,
      activeCount > 0,
      this.shape.rangeApplies
    );
  }

  /** Replaces the owned config with an updated copy. The only writer. */
  private updateConfig(patch: Partial<ChartConfig>): void {
    this.config = { ...this.config, ...patch };
  }

  private resetConfig(): void {
    this.updateConfig({
      type: this.settings.defaultChartType,
      properties: [""],
      colors: [CHART_COLORS_HEX[0]],
      dateFormat: this.settings.defaultDateFormat,
      range: { preset: this.settings.defaultRange },
    });
    this.heatmapYear = new Date().getFullYear();
    this.limitOverride = false;
    this.shape = PERMISSIVE_SHAPE;
    this.rebuildPropertySelects();
    void this.refresh();
  }

  private async copyCodeblock(btn: HTMLButtonElement): Promise<void> {
    const block = buildCodeblock(this.config, {
      heatmapYear: this.heatmapYear,
      segmentLabels: this.segmentLabels,
      rangeApplies: this.shape.rangeApplies,
    });

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
    const isDistribution = isDistributionType(this.config.type);
    const hasActiveProperty = activeProperties.length > 0;

    // Without a property there is no data shape to remember, so drop the state from the
    // previous selection instead of carrying its restrictions over.
    if (!hasActiveProperty || !this.config.folder) {
      this.shape = PERMISSIVE_SHAPE;
    }

    this.syncEarlyControlState(isHeatmap, hasActiveProperty);
    if (!hasActiveProperty || !this.config.folder) {
      this.renderEmptyState();
      return;
    }

    this.controlRefs?.dataHint.hide();

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
      // A heatmap collects within its year only, and text notes are typically undated, so
      // its own result cannot tell a text property from an empty year. Probe separately.
      const textProbe = isHeatmap ? await this.detectTextProperty(configToRender) : undefined;
      this.syncControlState(datasets, configToRender, isHeatmap, isDistribution, textProbe);
      await this.renderChartData(configToRender, datasets, isHeatmap);
    } catch (e) {
      console.error("Property Charts: render error", e);
      this.chartContainer.empty();
      this.chartContainer.createEl("p", {
        text: `Failed to render chart: ${errorMessage(e)}`,
        cls: CSS.error,
      });
    } finally {
      this.chartContainer.removeClass("is-loading");
      this.chartContainer.removeAttribute("aria-busy");
    }
  }

  /**
   * Tears the chart down and explains what is still missing. Reached whenever no folder
   * or no property is selected, including after a reset.
   */
  private renderEmptyState(): void {
    this.rebuildSegmentColorSection([]);
    this.renderer?.destroy();
    this.renderer = null;
    this.chartContainer.empty();
    this.chartContainer.hide();
    this.bannerContainer.empty();
    this.limitBanner = null;

    const message = !this.config.folder
      ? "Select a folder to get started."
      : "Select a property to create a chart.";
    this.emptyStateEl.setText(message);
    this.emptyStateEl.show();

    if (this.controlRefs) {
      this.controlRefs.dataHint.setText(message);
      this.controlRefs.dataHint.show();
    }
  }

  private syncEarlyControlState(isHeatmap: boolean, hasActiveProperty: boolean): void {
    this.yearNavContainer?.toggle(isHeatmap);
    if (this.controlRefs) {
      const activeCount = this.activePropertyCount;
      updateHeatmapButton(this.controlRefs, activeCount, this.shape.isText, this.shape.hasDates);
      updateDistributionButtons(
        this.controlRefs,
        activeCount,
        this.config.type,
        hasActiveProperty,
        this.shape.rangeApplies
      );
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
        range: yearRange(this.heatmapYear),
      };
    } else if (isDistribution) {
      collectConfig = { ...configToRender, range: { preset: "all" } };
    }

    if (isHeatmap || isDistribution) {
      return this.collector.collectDatasets(collectConfig, this.limitOverride);
    }

    // Line/bar: text properties are drawn as a frequency chart, which ignores the range.
    // collectForSeries() reports that case so the range controls and the exported code
    // block can agree with what is actually rendered.
    const { datasets, isTextFallback } = await this.collector.collectForSeries(
      collectConfig,
      this.limitOverride,
    );
    this.shape = { ...this.shape, rangeApplies: !isTextFallback };
    return datasets;
  }

  /**
   * Infers whether the selected properties hold text, independent of the active chart
   * type and range: the collection runs unfiltered, so undated notes are included.
   */
  private async detectTextProperty(config: ChartConfig): Promise<boolean> {
    const probe = await this.collector.collectDatasets(
      { ...config, range: { preset: "all" } },
      this.limitOverride,
    );
    return isTextDatasets(probe);
  }

  private syncControlState(
    datasets: Dataset[],
    configToRender: ChartConfig,
    isHeatmap: boolean,
    isDistribution: boolean,
    textProbe?: boolean,
  ): void {
    const isTextProperty = textProbe ?? isTextDatasets(datasets);

    const allPropsAreText = !isDistribution && isTextProperty;

    const hasAnyPoints = datasets.some((d) => d.points.length > 0);
    const hasDates =
      !isTextProperty &&
      (!hasAnyPoints || datasets.some((d) => d.points.some((p) => p.date !== null)));

    // Remembered so control updates outside a refresh keep the heatmap locked for text
    // properties instead of falling back to the permissive parameter defaults.
    this.shape = { ...this.shape, isText: isTextProperty, hasDates };

    if (isDistribution && datasets[0]) {
      // The segment order must match ChartRenderer's, which sorts the raw values before
      // stripping wiki links — otherwise the color pickers map to the wrong slices.
      const values = [...countValueFrequencies(datasets[0].points).keys()].sort();
      this.rebuildSegmentColorSection(values.map(stripWikiLinks));
    } else {
      this.rebuildSegmentColorSection([]);
    }

    if (this.controlRefs) {
      const activeCount = this.activePropertyCount;
      updateHeatmapButton(this.controlRefs, activeCount, isTextProperty, hasDates);
    }

    if (this.controlRefs && !isHeatmap && !isDistribution) {
      this.controlRefs.rangeSection.toggle(this.shape.rangeApplies);
    }

    if (this.controlRefs) {
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
        text: this.collector.explainEmptyResult(configToRender),
        cls: CSS.noDataMsg,
      });
      // The renderer was already destroyed and reset to null above, so the next
      // refresh() starts from a clean state.
      return;
    }

    this.renderer = new ChartRenderer(this.chartContainer);
    // The heatmap shows one full year and its range controls are hidden, so render it
    // against the year's bounds. Leaving the (invisible) range preset in place would
    // dim every cell outside it.
    const renderConfig = isHeatmap
      ? {
          ...configToRender,
          heatmapYear: this.heatmapYear,
          range: yearRange(this.heatmapYear),
        }
      : configToRender;
    await this.renderer.render(renderConfig, datasets);
    this.renderer.updateAriaLabel(renderConfig);

    this.bannerContainer.empty();
    this.limitBanner = null;
    const anyTruncated = datasets.find((d) => d.truncated);
    const totalCount = datasets.find((d) => d.totalCount !== undefined)?.totalCount ?? 0;
    if (anyTruncated) {
      this.limitBanner = this.bannerContainer.createDiv();
      renderLimitBanner(this.limitBanner, "truncated", totalCount, this.settings.fileLimit, async () => {
        this.limitOverride = true;
        await this.refresh();
      });
    } else if (this.limitOverride && totalCount > 0) {
      this.limitBanner = this.bannerContainer.createDiv();
      renderLimitBanner(this.limitBanner, "overridden", totalCount, this.settings.fileLimit, async () => {
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
colorAt(this.config.colors, i);

      row.createEl("label", { text: label });

      // Use onchange only so the chart re-renders after the picker is closed,
      // preventing the picker from closing mid-selection.
      colorInput.onchange = handle(async () => {
        this.updateConfig({
          colors: this.config.colors.map((c, k) => (k === i ? colorInput.value : c)),
        });
        await this.refresh();
      });
    });
  }
}

