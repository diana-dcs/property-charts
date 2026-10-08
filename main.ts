import { AbstractInputSuggest, Plugin, PluginSettingTab, App, Setting, SettingDefinitionItem, TFile, debounce } from "obsidian";
import { VIEW_TYPE_CHART, ChartView } from "./src/ChartView";
import { CodeBlockProcessor, CODE_BLOCK_LANGUAGE } from "./src/CodeBlockProcessor";
import {
  CHART_TYPE_LABELS,
  ChartType,
  DEFAULT_SETTINGS,
  PluginSettings,
  RANGE_PRESET_LABELS,
  RangePreset,
  isChartType,
  isRangePreset,
  normalizeFolderPath,
  toDisplayString,
} from "./src/types";

/** Narrows a declarative setting key to a known PluginSettings field. */
function isSettingsKey(key: string): key is keyof PluginSettings {
  return Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key);
}

export default class ChartPlugin extends Plugin {
  // Both are assigned in onload(), before any other plugin code can run.
  settings!: PluginSettings;
  private codeBlockProcessor!: CodeBlockProcessor;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.codeBlockProcessor = new CodeBlockProcessor(this.app, this.settings);

    // Register sidebar view
    this.registerView(
      VIEW_TYPE_CHART,
      (leaf) => new ChartView(leaf, this.settings)
    );

    // Register ```property-chart code block processor
    this.registerMarkdownCodeBlockProcessor(
      CODE_BLOCK_LANGUAGE,
      (source, el, ctx) => this.codeBlockProcessor.process(source, el, ctx)
    );

    // Ribbon icon
    this.addRibbonIcon("bar-chart-2", "Open chart view", () => {
      void this.activateView();
    });

    // Settings tab
    this.addSettingTab(new ChartPluginSettingTab(this.app, this));

    // Command palette
    this.addCommand({
      id: "open-chart-view",
      name: "Open chart view",
      callback: () => void this.activateView(),
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
          if (file instanceof TFile) this.refreshViews(file);
        })
      );
      // Chart colours are read from theme CSS variables at render time, so a
      // theme / dark-light switch needs a re-render. One frame of delay lets
      // Obsidian apply the new stylesheet before getComputedStyle() runs.
      this.registerEvent(
        this.app.workspace.on("css-change", () => {
          window.requestAnimationFrame(() => this.refreshViews());
        })
      );
    });
  }

  onunload(): void {
    this.codeBlockProcessor.scheduleRefreshAll.cancel();
  }

  private async activateView(): Promise<void> {
    const { workspace } = this.app;

    const existing = workspace.getLeavesOfType(VIEW_TYPE_CHART);
    if (existing.length > 0) {
      await workspace.revealLeaf(existing[0]);
      return;
    }

    const leaf = workspace.getRightLeaf(false);
    if (!leaf) return;

    await leaf.setViewState({ type: VIEW_TYPE_CHART, active: true });
    await workspace.revealLeaf(leaf);
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
    // loadData() is typed Promise<any>; narrow once here so the `any` does not
    // spread through the settings object.
    const stored = (await this.loadData()) as Partial<PluginSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...stored };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

class ChartPluginSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: ChartPlugin) {
    super(app, plugin);
  }

  /**
   * Declarative settings (Obsidian 1.13.0+) — makes these settings discoverable via
   * Obsidian's settings search. display() below is kept for older versions, which is
   * why manifest.json still allows minAppVersion 1.7.2. Both paths read and write the
   * same PluginSettings fields, and the option labels are shared via types.ts so the
   * two implementations cannot drift apart.
   */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: "Default folder",
        desc: "Folder pre-selected when the sidebar view opens.",
        control: {
          type: "folder",
          key: "defaultFolder",
          placeholder: "Search folders…",
          includeRoot: true,
        },
      },
      {
        name: "Date format",
        desc: "Moment.js format used to parse dates from filenames and frontmatter.",
        control: {
          type: "text",
          key: "defaultDateFormat",
          placeholder: DEFAULT_SETTINGS.defaultDateFormat,
        },
      },
      {
        name: "Default chart type",
        control: {
          type: "dropdown",
          key: "defaultChartType",
          options: CHART_TYPE_LABELS,
        },
      },
      {
        name: "Default time range",
        control: {
          type: "dropdown",
          key: "defaultRange",
          options: RANGE_PRESET_LABELS,
        },
      },
      {
        name: "File limit per chart",
        desc: "Maximum number of files processed per chart. A banner appears when the limit is exceeded. Set to 0 for no limit.",
        control: {
          type: "number",
          key: "fileLimit",
          placeholder: String(DEFAULT_SETTINGS.fileLimit),
          min: 0,
        },
      },
    ];
  }

  getControlValue(key: string): unknown {
    if (!isSettingsKey(key)) return undefined;
    return this.plugin.settings[key];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const settings = this.plugin.settings;

    switch (key) {
      case "defaultFolder":
        settings.defaultFolder = normalizeFolderPath(toDisplayString(value));
        break;
      case "defaultDateFormat":
        settings.defaultDateFormat =
          toDisplayString(value) || DEFAULT_SETTINGS.defaultDateFormat;
        break;
      case "defaultChartType":
        if (!isChartType(value)) return;
        settings.defaultChartType = value;
        break;
      case "defaultRange":
        if (!isRangePreset(value)) return;
        settings.defaultRange = value;
        break;
      case "fileLimit": {
        const parsed = Number(value);
        settings.fileLimit =
          Number.isFinite(parsed) && parsed >= 0
            ? Math.floor(parsed)
            : DEFAULT_SETTINGS.fileLimit;
        break;
      }
      default:
        return;
    }

    await this.plugin.saveSettings();
    this.plugin.applySettingsToViews();
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

      new FolderSuggest(this.app, text.inputEl, async (folder) => {
        this.plugin.settings.defaultFolder = folder;
        text.setValue(folder);
        await this.plugin.saveSettings();
        this.plugin.applySettingsToViews();
      });

      text.onChange(async (value) => {
        this.plugin.settings.defaultFolder = normalizeFolderPath(value);
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
          .addOptions(CHART_TYPE_LABELS)
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
          .addOptions(RANGE_PRESET_LABELS)
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
  private cb: (folder: string) => Promise<void>;

  constructor(app: App, inputEl: HTMLInputElement, cb: (folder: string) => Promise<void>) {
    super(app, inputEl);
    this.cb = cb;
  }

  getSuggestions(query: string): string[] {
    const folders = this.app.vault.getAllFolders(true).map((folder) => folder.path);
    const lower = query.toLowerCase();
    return folders.filter((f) => f.toLowerCase().includes(lower)).slice(0, 50);
  }

  renderSuggestion(folder: string, el: HTMLElement): void {
    el.setText(folder);
  }

  selectSuggestion(folder: string): void {
    void this.cb(folder);
    this.close();
  }
}
