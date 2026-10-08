import { App, TFile, TFolder, moment } from "obsidian";
import {
  ChartConfig,
  DataPoint,
  Dataset,
  PluginSettings,
  PropertyValueType,
  RANGE_PRESET_DAYS,
  RangeConfig,
  isInFolder,
  isTextDatasets,
} from "./types";

/**
 * Reads a frontmatter value as `unknown`.
 *
 * Obsidian types FrontMatterCache with an `any` index signature, so every direct
 * property access leaks `any` into typed code. This is the single place where that
 * `any` is converted into `unknown`, forcing callers to narrow explicitly.
 */
function readFrontmatterValue(
  frontmatter: Record<string, unknown>,
  key: string,
): unknown {
  if (!Object.prototype.hasOwnProperty.call(frontmatter, key)) return undefined;
  return frontmatter[key];
}

/** Accepts the value types moment can parse; anything else is rejected upfront. */
function isDateInput(value: unknown): value is string | number | Date {
  return typeof value === "string" || typeof value === "number" || value instanceof Date;
}

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
      if (isInFolder(filePath, folder)) this.propertiesCache.delete(folder);
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

  collectDatasets(config: ChartConfig, limitOverride = false): Promise<Dataset[]> {
    const files = this.getFilesInFolder(config.folder);
    const limit = (!limitOverride && this.settings.fileLimit > 0)
      ? this.settings.fileLimit
      : Infinity;

    const datasets: Dataset[] = config.properties.map((prop) => ({
      property: prop,
      points: [],
      valueType: "number",
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
        const raw = readFrontmatterValue(cache.frontmatter, dataset.property);
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

    return Promise.resolve(datasets);
  }

  /**
   * Collects datasets for a line/bar chart, retrying without the range filter when the
   * property turns out to hold text.
   *
   * Text values have no temporal meaning — they are drawn as a frequency chart, which
   * ignores the range — and the notes carrying them are usually undated, so the range
   * filter excludes them wholesale. The fallback is only adopted when it really is
   * text-typed; a numeric property keeps its (correctly) empty result so the user still
   * learns that the range is too narrow.
   *
   * `isTextFallback` tells the caller that the range was not applied, so it can hide the
   * range controls and leave `range:` out of the exported code block.
   */
  async collectForSeries(
    config: ChartConfig,
    limitOverride = false,
  ): Promise<{ datasets: Dataset[]; isTextFallback: boolean }> {
    const datasets = await this.collectDatasets(config, limitOverride);
    const unfiltered = config.range.preset === "all";

    // Text data found inside the range: the frequency chart ignores the range anyway, so
    // widen the collection to match the hidden range controls.
    if (isTextDatasets(datasets)) {
      if (unfiltered) return { datasets, isTextFallback: true };
      const all = await this.collectDatasets(
        { ...config, range: { preset: "all" } },
        limitOverride,
      );
      return { datasets: isTextDatasets(all) ? all : datasets, isTextFallback: true };
    }

    if (datasets.some((d) => d.points.length > 0) || unfiltered) {
      return { datasets, isTextFallback: false };
    }

    // Nothing in range: the property may be text on undated notes, which the range
    // filter drops entirely.
    const fallback = await this.collectDatasets(
      { ...config, range: { preset: "all" } },
      limitOverride,
    );
    return isTextDatasets(fallback)
      ? { datasets: fallback, isTextFallback: true }
      : { datasets, isTextFallback: false };
  }

  /**
   * Explains why a collection came back empty. "No data in this time range" is only
   * one of several causes, and it is the misleading answer for the most common one:
   * a mistyped property name.
   */
  explainEmptyResult(config: ChartConfig): string {
    const folderLabel = config.folder === "" ? "/" : config.folder;

    const files = this.getFilesInFolder(config.folder);
    if (files.length === 0) {
      return `No markdown notes found in "${folderLabel}".`;
    }

    const available = this.getPropertiesInFolder(config.folder);
    const missing = config.properties.filter((prop) => !available.includes(prop));
    if (missing.length > 0) {
      const names = missing.map((prop) => `"${prop}"`).join(", ");
      const subject = missing.length === 1 ? "Property" : "Properties";
      if (available.length === 0) {
        return `${subject} ${names} not found — no note in "${folderLabel}" has frontmatter properties.`;
      }
      const shown = available.slice(0, 15).join(", ");
      const more = available.length > 15 ? ", …" : "";
      return `${subject} ${names} not found in "${folderLabel}". Available: ${shown}${more}.`;
    }

    const anyDated = files.some((file) => this.resolveDate(file, config.dateFormat) !== null);
    if (!anyDated) {
      return `No note has a readable date. Check that dateFormat (${config.dateFormat}) matches your filenames or the frontmatter "date" property.`;
    }

    return `No data in the selected time range. Try a wider range such as range: all.`;
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
    const fmDate = cache?.frontmatter
      ? readFrontmatterValue(cache.frontmatter, "date")
      : undefined;
    if (isDateInput(fmDate)) {
      const parsed = moment(fmDate, dateFormat, true);
      if (parsed.isValid()) return parsed.toDate();

      // Try common formats as strict fallback (no lenient parse)
      const fallback = moment(fmDate, DataCollector.FALLBACK_DATE_FORMATS, true);
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
    if (range.from && range.to) {
      return { from: range.from, to: range.to };
    }

    // 'all' and an absent preset both mean "no bounds".
    const days = range.preset ? RANGE_PRESET_DAYS[range.preset] : null;
    if (days === null) return { from: null, to: null };

    return {
      from: moment().subtract(days, "days").format("YYYY-MM-DD"),
      to: moment().format("YYYY-MM-DD"),
    };
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
    if (typeof raw === "number") return "number";
    if (typeof raw === "string") {
      const num = parseFloat(raw);
      if (!isNaN(num)) return "number";
      return "text";
    }
    return "number";
  }
}
