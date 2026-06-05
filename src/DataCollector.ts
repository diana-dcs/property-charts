import { App, TFile, TFolder } from "obsidian";
import {
  ChartConfig,
  DataPoint,
  Dataset,
  PropertyValueType,
  RangeConfig,
} from "./types";

export class DataCollector {
  private propertiesCache = new Map<string, string[]>();

  constructor(private app: App) {
    // Invalidate cache when any file's metadata changes
    this.app.metadataCache.on("changed", () => this.propertiesCache.clear());
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

    return folder.children
      .filter((f): f is TFile => f instanceof TFile && f.extension === "md")
      .sort((a, b) => a.basename.localeCompare(b.basename));
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

  async collectDatasets(config: ChartConfig): Promise<Dataset[]> {
    const files = this.getFilesInFolder(config.folder);
    const datasets: Dataset[] = config.properties.map((prop) => ({
      property: prop,
      points: [],
      valueType: "number" as PropertyValueType,
    }));

    const { from: fromStr, to: toStr } = this.resolveRange(config.range);

    for (const file of files) {
      const date = this.resolveDate(file, config.dateFormat);
      if (!date) continue;

      // Both sides use moment's local-time formatting, so timezone is consistent.
      const dateStr = window.moment(date).format("YYYY-MM-DD");
      if (fromStr && dateStr < fromStr) continue;
      if (toStr && dateStr > toStr) continue;

      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache?.frontmatter) continue;

      for (const dataset of datasets) {
        const raw = cache.frontmatter[dataset.property];
        if (raw === undefined || raw === null) continue;

        const point: DataPoint = {
          date,
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

    // Sort all datasets by date
    for (const dataset of datasets) {
      dataset.points.sort((a, b) => a.date.getTime() - b.date.getTime());
    }

    return datasets;
  }

  private resolveDate(file: TFile, dateFormat: string): Date | null {
    const cache = this.app.metadataCache.getFileCache(file);

    // 1. Try frontmatter 'date' property
    if (cache?.frontmatter?.date) {
      const parsed = window.moment(cache.frontmatter.date, dateFormat, true);
      if (parsed.isValid()) return parsed.toDate();

      // Try common formats as fallback
      const fallback = window.moment(cache.frontmatter.date);
      if (fallback.isValid()) return fallback.toDate();
    }

    // 2. Try filename with configured format, then fall back to auto-detection
    const parsed = window.moment(file.basename, dateFormat, true);
    if (parsed.isValid()) return parsed.toDate();

    const filenameFallback = window.moment(file.basename);
    if (filenameFallback.isValid()) return filenameFallback.toDate();

    return null;
  }

  private resolveRange(
    range: RangeConfig
  ): { from: string | null; to: string | null } {
    const today = window.moment().format("YYYY-MM-DD");

    if (range.from && range.to) {
      return { from: range.from, to: range.to };
    }

    if (range.preset === "7d") {
      return { from: window.moment().subtract(7, "days").format("YYYY-MM-DD"), to: today };
    }

    if (range.preset === "30d") {
      return { from: window.moment().subtract(30, "days").format("YYYY-MM-DD"), to: today };
    }

    if (range.preset === "90d") {
      return { from: window.moment().subtract(90, "days").format("YYYY-MM-DD"), to: today };
    }

    // 'all' or undefined
    return { from: null, to: null };
  }

  private normalizeValue(raw: unknown): number | string | boolean | null {
    if (typeof raw === "number") return raw;
    if (typeof raw === "boolean") return raw ? 1 : 0;
    if (typeof raw === "string") {
      const num = parseFloat(raw);
      if (!isNaN(num)) return num;
      return raw;
    }
    return null;
  }

  private inferValueType(raw: unknown): PropertyValueType {
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
