import { Plugin, PluginSettingTab, App, Setting, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE_CHART, ChartView } from "./src/ChartView";
import { CodeBlockProcessor } from "./src/CodeBlockProcessor";
import { ChartType, DEFAULT_SETTINGS, PluginSettings, RangePreset } from "./src/types";

export default class ChartPlugin extends Plugin {
  settings: PluginSettings;
  private codeBlockProcessor: CodeBlockProcessor;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.codeBlockProcessor = new CodeBlockProcessor(this.app, this.settings);

    // Register sidebar view
    this.registerView(
      VIEW_TYPE_CHART,
      (leaf) => new ChartView(leaf, this.settings)
    );

    // Register ```chart code block processor
    this.registerMarkdownCodeBlockProcessor(
      "chart",
      this.codeBlockProcessor.process.bind(this.codeBlockProcessor)
    );

    // Ribbon icon
    this.addRibbonIcon("bar-chart-2", "Open Chart View", () => {
      this.activateView();
    });

    // Settings tab
    this.addSettingTab(new ChartPluginSettingTab(this.app, this));

    // Command palette
    this.addCommand({
      id: "open-chart-view",
      name: "Open Chart View",
      callback: () => this.activateView(),
    });

    // Auto-refresh on metadata changes (vault file modified)
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        this.refreshViews();
      })
    );

    this.registerEvent(
      this.app.vault.on("create", () => {
        this.refreshViews();
      })
    );

    this.registerEvent(
      this.app.vault.on("delete", () => {
        this.refreshViews();
      })
    );
  }

  async onunload(): Promise<void> {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_CHART);
  }

  private async activateView(): Promise<void> {
    const { workspace } = this.app;

    const existing = workspace.getLeavesOfType(VIEW_TYPE_CHART);
    if (existing.length > 0) {
      workspace.revealLeaf(existing[0]);
      return;
    }

    const leaf = workspace.getRightLeaf(false);
    if (!leaf) return;

    await leaf.setViewState({ type: VIEW_TYPE_CHART, active: true });
    workspace.revealLeaf(leaf);
  }

  applySettingsToViews(): void {
    this.app.workspace.getLeavesOfType(VIEW_TYPE_CHART).forEach((leaf) => {
      if (leaf.view instanceof ChartView) {
        leaf.view.onSettingsChanged(this.settings);
      }
    });
  }

  private refreshViews(): void {
    this.app.workspace.getLeavesOfType(VIEW_TYPE_CHART).forEach((leaf) => {
      if (leaf.view instanceof ChartView) {
        leaf.view.scheduleRefresh();
      }
    });

    // Embedded charts are re-rendered by Obsidian automatically when the
    // markdown post-processor re-runs; we just clear the renderer cache
    this.codeBlockProcessor.scheduleRefreshAll();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

class ChartPluginSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: ChartPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Default folder")
      .setDesc("Folder pre-selected when the sidebar view opens.")
      .addText((text) =>
        text
          .setPlaceholder("e.g. Daily Notes")
          .setValue(this.plugin.settings.defaultFolder)
          .onChange(async (value) => {
            this.plugin.settings.defaultFolder = value;
            await this.plugin.saveSettings();
            this.plugin.applySettingsToViews();
          })
      );

    new Setting(containerEl)
      .setName("Date format")
      .setDesc("Moment.js format used to parse dates from filenames and frontmatter.")
      .addText((text) =>
        text
          .setPlaceholder("YYYY-MM-DD")
          .setValue(this.plugin.settings.defaultDateFormat)
          .onChange(async (value) => {
            this.plugin.settings.defaultDateFormat = value || "YYYY-MM-DD";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Default chart type")
      .addDropdown((drop) =>
        drop
          .addOptions({ line: "Line", bar: "Bar" })
          .setValue(this.plugin.settings.defaultChartType)
          .onChange(async (value) => {
            this.plugin.settings.defaultChartType = value as ChartType;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Default time range")
      .addDropdown((drop) =>
        drop
          .addOptions({ "7d": "7 days", "30d": "30 days", "90d": "90 days", all: "All" })
          .setValue(this.plugin.settings.defaultRange)
          .onChange(async (value) => {
            this.plugin.settings.defaultRange = value as RangePreset;
            await this.plugin.saveSettings();
          })
      );
  }
}
