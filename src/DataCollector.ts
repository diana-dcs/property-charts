import { App, TFile, TFolder } from "obsidian";
import { moment } from "./moment";
import {
  ChartConfig,
  DataPoint,
  Dataset,
  PluginSettings,
  PropertyValueType,
  RANGE_PRESET_DAYS,
  RangeConfig,
  datasetsIgnoreRange,
  isInFolder,
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

/** Separates folder from property name in the property-type cache key. */
const TYPE_KEY_SEP = "\u0000";

/** Accepts the value types moment can parse; anything else is rejected upfront. */
function isDateInput(value: unknown): value is string | number | Date {
  return typeof value === "string" || typeof value === "number" || value instanceof Date;
}

/**
 * Whether a frontmatter value means "checkbox ticked". Only a real YAML boolean counts —
 * a `"true"` string belongs to a text property, and such a property never reaches here
 * because resolvePropertyType() would not call it boolean.
 */
function isCheckboxChecked(raw: unknown): boolean {
  if (Array.isArray(raw)) return (raw as unknown[]).some((item) => item === true);
  return raw === true;
}

export interface CollectOptions {
  /**
   * Whether a checkbox property is read as a closed set over the whole folder: every note
   * that does not have the box ticked contributes a `false` point, including notes without
   * the property and notes without frontmatter at all.
   *
   * Default. The heatmap turns it off: it draws one cell per dated note, so filling in
   * thousands of unticked notes would say nothing the empty grid does not already say.
   */
  checkboxFill?: boolean;
}

export class DataCollector {
  private propertiesCache = new Map<string, string[]>();
  private propertyTypeCache = new Map<string, PropertyValueType>();
  private dateCache = new Map<string, Date | null>();

  constructor(private app: App, private settings: PluginSettings) {}

  updateSettings(settings: PluginSettings): void {
    this.settings = settings;
  }

  clearPropertyCache(filePath?: string): void {
    if (!filePath) {
      this.propertiesCache.clear();
      this.propertyTypeCache.clear();
      this.dateCache.clear();
      return;
    }
    for (const folder of this.propertiesCache.keys()) {
      if (isInFolder(filePath, folder)) this.propertiesCache.delete(folder);
    }
    for (const key of this.propertyTypeCache.keys()) {
      const folder = key.slice(0, key.indexOf(TYPE_KEY_SEP));
      if (isInFolder(filePath, folder)) this.propertyTypeCache.delete(key);
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

  collectDatasets(
    config: ChartConfig,
    limitOverride = false,
    options: CollectOptions = {},
  ): Promise<Dataset[]> {
    const files = this.getFilesInFolder(config.folder);
    const limit = (!limitOverride && this.settings.fileLimit > 0)
      ? this.settings.fileLimit
      : Infinity;

    // The type comes from every value of the property in the folder, not from the first
    // note that happens to carry one: a single odd value used to retype a whole dataset.
    const datasets: Dataset[] = config.properties.map((prop) => ({
      property: prop,
      points: [],
      valueType: this.resolvePropertyType(config.folder, prop, files),
    }));

    // Which datasets read their property as a closed Checked/Unchecked set over the folder.
    const fills = datasets.map(
      (dataset) => options.checkboxFill !== false && dataset.valueType === "boolean",
    );
    const anyFill = fills.some(Boolean);

    const { from: fromStr, to: toStr } = this.resolveRange(config.range);
    const hasRangeFilter = fromStr !== null || toStr !== null;

    let collected = 0;
    let truncated = false;

    for (const file of files) {
      const date = this.resolveDate(file, config.dateFormat);

      let inRange = true;
      if (date) {
        // Dated file: apply the range filter.
        const dateStr = moment(date).format("YYYY-MM-DD");
        if (fromStr && dateStr < fromStr) inRange = false;
        if (toStr && dateStr > toStr) inRange = false;
      } else if (hasRangeFilter) {
        // Undated file: no temporal position — exclude whenever a range is active.
        // Only "all" (no filter) includes undated files.
        inRange = false;
      }

      // A filled checkbox dataset counts the whole folder, so the range cannot drop the
      // note; without one, an out-of-range note still contributes nothing.
      if (!inRange && !anyFill) continue;

      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = cache?.frontmatter;
      // A note without frontmatter is an unticked note for a checkbox dataset; for every
      // other property it carries no value and is skipped before it consumes the limit.
      if (!frontmatter && !anyFill) continue;

      if (collected >= limit) {
        truncated = true;
        break;
      }
      collected++;

      for (const [i, dataset] of datasets.entries()) {
        const fill = fills[i];
        if (!fill && !inRange) continue;

        const raw = frontmatter
          ? readFrontmatterValue(frontmatter, dataset.property)
          : undefined;

        if (fill) {
          const checked = isCheckboxChecked(raw);
          dataset.points.push({
            date,
            label: file.basename,
            rawValue: checked,
            value: checked ? 1 : 0,
          });
          continue;
        }

        if (raw === undefined || raw === null) continue;

        const point: DataPoint = {
          date,
          label: file.basename,
          rawValue: raw,
          value: this.normalizeValue(raw),
        };
        dataset.points.push(point);
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
    if (datasetsIgnoreRange(datasets)) {
      if (unfiltered) return { datasets, isTextFallback: true };
      const all = await this.collectDatasets(
        { ...config, range: { preset: "all" } },
        limitOverride,
      );
      return { datasets: datasetsIgnoreRange(all) ? all : datasets, isTextFallback: true };
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
    return datasetsIgnoreRange(fallback)
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

  /**
   * The value type of a property across a whole folder, memoized per folder+property.
   * Invalidated together with the property list in clearPropertyCache().
   */
  private resolvePropertyType(
    folder: string,
    property: string,
    files: TFile[],
  ): PropertyValueType {
    const key = folder + TYPE_KEY_SEP + property;
    const cached = this.propertyTypeCache.get(key);
    if (cached) return cached;

    const result = this.computePropertyType(property, files);
    this.propertyTypeCache.set(key, result);
    return result;
  }

  /**
   * Scans every value of the property in the folder. The type is only "boolean" when all
   * of them are real YAML booleans — a mixed property must not be drawn as a checkbox,
   * because the Unchecked bucket would then silently absorb unrelated values.
   */
  private computePropertyType(property: string, files: TFile[]): PropertyValueType {
    let seen: PropertyValueType | null = null;

    for (const file of files) {
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!frontmatter) continue;

      const raw = readFrontmatterValue(frontmatter, property);
      for (const type of this.elementTypes(raw)) {
        if (seen === null) {
          seen = type;
        } else if (seen !== type) {
          // Mixed values: text wins over numbers, and a boolean mixed with anything is
          // no longer a checkbox.
          return seen === "text" || type === "text" ? "text" : "number";
        }
      }
    }

    return seen ?? "number";
  }

  /** The types a raw frontmatter value contributes — one per element for list properties. */
  private elementTypes(raw: unknown): PropertyValueType[] {
    if (raw === undefined || raw === null) return [];
    const items = Array.isArray(raw) ? (raw as unknown[]) : [raw];
    return items
      .filter((item) => item !== undefined && item !== null)
      .map((item) => this.inferValueType(item));
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
