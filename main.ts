import { AbstractInputSuggest, Plugin, PluginSettingTab, App, Setting, TFile, TFolder, WorkspaceLeaf, debounce } from "obsidian";
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

    // Defer event listeners until after Obsidian finishes loading the workspace.
    // Registering vault.on("create") earlier causes it to fire for every file
    // during startup, which would trigger refreshViews() hundreds of times.
    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(
        this.app.metadataCache.on("changed", (file) => {
          this.codeBlockProcessor.clearPropertyCache(file.path);
          this.refreshViews(file);
        })
      );
      this.registerEvent(
        this.app.vault.on("create", (file) => {
          if (file instanceof TFile) this.refreshViews(file);
        })
      );
      this.registerEvent(
        this.app.vault.on("delete", (file) => {
          this.codeBlockProcessor.pruneStaleEntries();
          if (file instanceof TFile) this.refreshViews(file);
        })
      );
    });
  }

  onunload(): void {}

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
    this.codeBlockProcessor.updateSettings(this.settings);
    this.app.workspace.getLeavesOfType(VIEW_TYPE_CHART).forEach((leaf) => {
      if (leaf.view instanceof ChartView) {
        leaf.view.onSettingsChanged(this.settings);
      }
    });
  }

  private refreshViews(file?: TFile): void {
    this.app.workspace.getLeavesOfType(VIEW_TYPE_CHART).forEach((leaf) => {
      if (leaf.view instanceof ChartView) {
        if (!file) {
          leaf.view.scheduleRefresh();
          return;
        }
        const folder = leaf.view.getFolder();
        const prefix = folder === "/" ? "" : folder + "/";
        if (file.path.startsWith(prefix)) leaf.view.scheduleRefresh();
      }
    });

    this.codeBlockProcessor.scheduleRefreshAll(file?.path);
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

    const folderSetting = new Setting(containerEl)
      .setName("Default folder")
      .setDesc("Folder pre-selected when the sidebar view opens.");

    folderSetting.addText((text) => {
      text
        .setPlaceholder("Search folders…")
        .setValue(this.plugin.settings.defaultFolder);

      new FolderSuggest(this.app, text.inputEl, (folder) => {
        this.plugin.settings.defaultFolder = folder;
        this.plugin.saveSettings();
        this.plugin.applySettingsToViews();
        text.setValue(folder);
      });

      text.onChange(async (value) => {
        this.plugin.settings.defaultFolder = value;
        await this.plugin.saveSettings();
        this.plugin.applySettingsToViews();
      });
    });

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
          .addOptions({
            line: "Line",
            bar: "Bar",
            heatmap: "Heatmap",
            pie: "Pie",
            doughnut: "Doughnut",
            polarArea: "Polar Area",
          })
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

    new Setting(containerEl)
      .setName("File limit per chart")
      .setDesc("Maximum number of files processed per chart. A banner appears when the limit is exceeded. Set to 0 for no limit.")
      .addText((text) =>
        text
          .setPlaceholder("5000")
          .setValue(String(this.plugin.settings.fileLimit))
          .onChange(debounce(async (value) => {
            const parsed = parseInt(value, 10);
            this.plugin.settings.fileLimit = (!isNaN(parsed) && parsed >= 0) ? parsed : 5000;
            await this.plugin.saveSettings();
            this.plugin.applySettingsToViews();
          }, 500, true))
      );
  }
}

class FolderSuggest extends AbstractInputSuggest<string> {
  private cb: (folder: string) => void;

  constructor(app: App, inputEl: HTMLInputElement, cb: (folder: string) => void) {
    super(app, inputEl);
    this.cb = cb;
  }

  getSuggestions(query: string): string[] {
    const folders: string[] = [];
    const recurse = (folder: TFolder) => {
      folders.push(folder.path === "/" ? "/" : folder.path);
      for (const child of folder.children) {
        if (child instanceof TFolder) recurse(child);
      }
    };
    recurse(this.app.vault.getRoot());

    const lower = query.toLowerCase();
    return folders.filter((f) => f.toLowerCase().includes(lower)).slice(0, 50);
  }

  renderSuggestion(folder: string, el: HTMLElement): void {
    el.setText(folder);
  }

  selectSuggestion(folder: string): void {
    this.cb(folder);
    this.close();
  }
}
