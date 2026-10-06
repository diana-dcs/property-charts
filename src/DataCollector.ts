import { App, TFile, TFolder, moment } from "obsidian";
import {
  ChartConfig,
  DataPoint,
  Dataset,
  PluginSettings,
  PropertyValueType,
  RangeConfig,
} from "./types";

export class DataCollector {
  private propertiesCache = new Map<string, string[]>();
  private dateCache = new Map<string, Date | null>();

  constructor(private app: App, private settings: PluginSettings) {}

  updateSettings(settings: PluginSettings): void {
    this.settings = settings;
  }

  clearPropertyCache(filePath?: string): void {
    if (!filePath) {
      this.propertiesCache.clear();
      this.dateCache.clear();
      return;
    }
    for (const folder of this.propertiesCache.keys()) {
      const prefix = folder === "/" ? "" : folder + "/";
      if (filePath.startsWith(prefix)) {
        this.propertiesCache.delete(folder);
      }
    }
    const datePrefix = filePath + ":";
    for (const key of this.dateCache.keys()) {
      if (key.startsWith(datePrefix)) this.dateCache.delete(key);
    }
  }

  getAllFolders(): string[] {
    const folders: string[] = ["/"];
    const recurse = (folder: TFolder) => {
      for (const child of folder.children) {
        if (child instanceof TFolder) {
          folders.push(child.path);
          recurse(child);
        }
      }
    };
    recurse(this.app.vault.getRoot());
    return folders;
  }

  getFilesInFolder(folderPath: string): TFile[] {
    const folder =
      folderPath === "/"
        ? this.app.vault.getRoot()
        : this.app.vault.getFolderByPath(folderPath);

    if (!folder) return [];

    const files: TFile[] = [];
    const collect = (f: TFolder) => {
      for (const child of f.children) {
        if (child instanceof TFile && child.extension === "md") files.push(child);
        else if (child instanceof TFolder) collect(child);
      }
    };
    collect(folder);
    return files.sort((a, b) => a.basename.localeCompare(b.basename));
  }

  getPropertiesInFolder(folderPath: string): string[] {
    const cached = this.propertiesCache.get(folderPath);
    if (cached) return cached;

    const files = this.getFilesInFolder(folderPath);
    const propertySet = new Set<string>();

    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (cache?.frontmatter) {
        for (const key of Object.keys(cache.frontmatter)) {
          if (key !== "position") propertySet.add(key);
        }
      }
    }

    const result = Array.from(propertySet).sort();
    this.propertiesCache.set(folderPath, result);
    return result;
  }

  async collectDatasets(config: ChartConfig, limitOverride = false): Promise<Dataset[]> {
    const files = this.getFilesInFolder(config.folder);
    const limit = (!limitOverride && this.settings.fileLimit > 0)
      ? this.settings.fileLimit
      : Infinity;

    const datasets: Dataset[] = config.properties.map((prop) => ({
      property: prop,
      points: [],
      valueType: "number" as PropertyValueType,
    }));

    const { from: fromStr, to: toStr } = this.resolveRange(config.range);
    const hasRangeFilter = fromStr !== null || toStr !== null;

    let collected = 0;
    let truncated = false;

    for (const file of files) {
      const date = this.resolveDate(file, config.dateFormat);

      if (date) {
        // Dated file: apply the range filter.
        const dateStr = moment(date).format("YYYY-MM-DD");
        if (fromStr && dateStr < fromStr) continue;
        if (toStr && dateStr > toStr) continue;
      } else if (hasRangeFilter) {
        // Undated file: no temporal position — exclude whenever a range is active.
        // Only "all" (no filter) includes undated files.
        continue;
      }

      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache?.frontmatter) continue;

      if (collected >= limit) {
        truncated = true;
        break;
      }
      collected++;

      for (const dataset of datasets) {
        if (!Object.prototype.hasOwnProperty.call(cache.frontmatter, dataset.property)) continue;
        const raw = cache.frontmatter[dataset.property];
        if (raw === undefined || raw === null) continue;

        const point: DataPoint = {
          date,
          label: file.basename,
          rawValue: raw,
          value: this.normalizeValue(raw),
        };
        dataset.points.push(point);

        // Infer value type from first non-null value
        if (dataset.points.length === 1) {
          dataset.valueType = this.inferValueType(raw);
        }
      }
    }

    // Sort: dated files chronologically first, then undated files alphabetically
    for (const dataset of datasets) {
      dataset.points.sort((a, b) => {
        if (a.date && b.date) return a.date.getTime() - b.date.getTime();
        if (a.date) return -1;
        if (b.date) return 1;
        return a.label.localeCompare(b.label);
      });
      dataset.truncated = truncated;
      dataset.totalCount = files.length;
    }

    return datasets;
  }

  private static readonly FALLBACK_DATE_FORMATS = [
    "YYYY-MM-DD",
    "YYYY/MM/DD",
    "DD.MM.YYYY",
    "MM/DD/YYYY",
    "YYYYMMDD",
  ];

  private resolveDate(file: TFile, dateFormat: string): Date | null {
    const cacheKey = file.path + ":" + dateFormat;
    if (this.dateCache.has(cacheKey)) return this.dateCache.get(cacheKey)!;

    const result = this.computeDate(file, dateFormat);
    this.dateCache.set(cacheKey, result);
    return result;
  }

  private computeDate(file: TFile, dateFormat: string): Date | null {
    const cache = this.app.metadataCache.getFileCache(file);

    // 1. Try frontmatter 'date' property
    if (cache?.frontmatter?.date) {
      const parsed = moment(cache.frontmatter.date, dateFormat, true);
      if (parsed.isValid()) return parsed.toDate();

      // Try common formats as strict fallback (no lenient parse)
      const fallback = moment(
        cache.frontmatter.date,
        DataCollector.FALLBACK_DATE_FORMATS,
        true,
      );
      if (fallback.isValid()) return fallback.toDate();
    }

    // 2. Try filename with configured format, then common formats — always strict
    const parsed = moment(file.basename, dateFormat, true);
    if (parsed.isValid()) return parsed.toDate();

    const filenameFallback = moment(
      file.basename,
      DataCollector.FALLBACK_DATE_FORMATS,
      true,
    );
    if (filenameFallback.isValid()) return filenameFallback.toDate();

    return null;
  }

  private resolveRange(
    range: RangeConfig
  ): { from: string | null; to: string | null } {
    const today = moment().format("YYYY-MM-DD");

    if (range.from && range.to) {
      return { from: range.from, to: range.to };
    }

    if (range.preset === "7d") {
      return { from: moment().subtract(7, "days").format("YYYY-MM-DD"), to: today };
    }

    if (range.preset === "30d") {
      return { from: moment().subtract(30, "days").format("YYYY-MM-DD"), to: today };
    }

    if (range.preset === "90d") {
      return { from: moment().subtract(90, "days").format("YYYY-MM-DD"), to: today };
    }

    // 'all' or undefined
    return { from: null, to: null };
  }

  private normalizeValue(raw: unknown): number | string | boolean | null {
    if (typeof raw === "number") {
      if (!isFinite(raw)) return null;
      return raw;
    }
    if (typeof raw === "boolean") return raw ? 1 : 0;
    if (typeof raw === "string") {
      const num = parseFloat(raw);
      if (!isNaN(num)) {
        // parseFloat("Infinity") → Infinity: reject non-finite parsed numbers
        return isFinite(num) ? num : null;
      }
      if (raw.trim() !== "") return raw;
      return null;
    }
    return null;
  }

  private inferValueType(raw: unknown): PropertyValueType {
    if (Array.isArray(raw)) {
      // List properties: use the first element to determine the type.
      return raw.length > 0 ? this.inferValueType(raw[0]) : "number";
    }
    if (typeof raw === "boolean") return "boolean";
    if (typeof raw === "number") {
      if (Number.isInteger(raw) && raw >= 1 && raw <= 10) return "rating";
      return "number";
    }
    if (typeof raw === "string") {
      const num = parseFloat(raw);
      if (!isNaN(num)) return "number";
      return "text";
    }
    return "number";
  }

  /** Samples the first available value of a property to infer its type without a full collection. */
  getPropertyType(folderPath: string, property: string): PropertyValueType {
    for (const file of this.getFilesInFolder(folderPath)) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache?.frontmatter) continue;
      if (!Object.prototype.hasOwnProperty.call(cache.frontmatter, property)) continue;
      const raw = cache.frontmatter[property];
      if (raw !== undefined && raw !== null) return this.inferValueType(raw);
    }
    return "number";
  }

  /** For text-type properties: returns frequency map */
  getTextFrequencies(dataset: Dataset): Record<string, number> {
    const freq: Record<string, number> = {};
    for (const point of dataset.points) {
      if (typeof point.rawValue === "string") {
        freq[point.rawValue] = (freq[point.rawValue] ?? 0) + 1;
      }
    }
    return freq;
  }
}
