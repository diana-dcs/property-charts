import {
  ALL_RANGE_PRESETS,
  RangePreset,
  CHART_COLORS_HEX,
  CHART_TYPE_LABELS,
  CSS,
  ChartConfig,
  ChartType,
  RANGE_PRESET_LABELS,
  DISTRIBUTION_TYPES,
  TREND_TYPES,
  colorAt,
  isDistributionType,
} from "./types";
import { DataCollector } from "./DataCollector";
import { handle } from "./eventHandlers";

/**
 * The control elements the view keeps updating after they are built. Every field is
 * required: each builder returns its own refs and buildControls merely composes them, so
 * the compiler can prove they all exist and callers need no presence checks.
 */
/** Links the disabled single-dataset buttons to the hint explaining why, for a11y. */
const SINGLE_DATASET_HINT_ID = "chart-single-dataset-hint";

export interface ControlRefs {
  folderSelect: HTMLSelectElement;
  propSection: HTMLElement;
  dataHint: HTMLElement;
  addBtn: HTMLButtonElement;
  /** Every chart-type button, keyed by the type it selects. */
  typeBtns: Map<ChartType, HTMLButtonElement>;
  heatmapHint: HTMLElement;
  singleDatasetHint: HTMLElement;
  rangeSection: HTMLElement;
  rangePresetBtns: Map<RangePreset, HTMLButtonElement>;
  customRangeBtn: HTMLButtonElement;
  showCustomRange: (visible: boolean) => void;
  fromInput: HTMLInputElement;
  toInput: HTMLInputElement;
  dateError: HTMLElement;
}

/**
 * Renders the config into the controls: which buttons look active, what the folder
 * select shows, whether the custom-range rows are open.
 *
 * The single place that does this, so a programmatic change (Reset, or a new default
 * folder arriving from the settings) shows up in the UI exactly as a click does. The
 * click handlers used to move the `active` class themselves, which left Reset updating
 * the chart while the buttons still showed the previous selection.
 */
export function syncControlsToConfig(refs: ControlRefs, config: ChartConfig): void {
  refs.folderSelect.value = config.folder;

  for (const [type, btn] of refs.typeBtns) {
    btn.toggleClass("active", type === config.type);
  }

  const isCustomRange = !config.range.preset;
  for (const [preset, btn] of refs.rangePresetBtns) {
    btn.toggleClass("active", config.range.preset === preset);
  }
  refs.customRangeBtn.toggleClass("active", isCustomRange);
  refs.showCustomRange(isCustomRange);

  refs.fromInput.value = config.range.from ?? "";
  refs.toInput.value = config.range.to ?? "";
  refs.dateError.hide();
}

export interface ControlCallbacks {
  /**
   * The view's current config. A getter rather than a captured object: the view
   * replaces its config on every change, so a reference taken at build time would go
   * stale inside these long-lived event handlers.
   */
  getConfig: () => ChartConfig;
  /** Reports a change for the view to apply. The controls never write the config. */
  onConfigChange: (patch: Partial<ChartConfig>) => void;
  onRefresh: () => Promise<void>;
  onRebuildPropertySelects: () => void;
  /** Asks the view to re-render the controls from the config it now holds. */
  onControlsChanged: () => void;
  onReset: () => void;
}

export function buildControls(
  root: HTMLElement,
  collector: DataCollector,
  callbacks: ControlCallbacks
): ControlRefs {
  const controls = root.createDiv({ cls: CSS.controls });
  const config = callbacks.getConfig();

  const refs: ControlRefs = {
    ...buildDataSection(controls, config, collector, callbacks),
    ...buildVisualizationSection(controls, callbacks),
    ...buildRangeSection(controls, callbacks),
  };

  syncControlsToConfig(refs, config);
  return refs;
}

type DataSectionRefs = Pick<
  ControlRefs,
  "folderSelect" | "propSection" | "dataHint" | "addBtn"
>;

function buildDataSection(
  controls: HTMLElement,
  config: ChartConfig,
  collector: DataCollector,
  callbacks: ControlCallbacks
): DataSectionRefs {
  const section = controls.createDiv({ cls: CSS.section });
  const titleRow = section.createDiv({ cls: CSS.sectionTitleRow });
  titleRow.createDiv({ cls: CSS.sectionTitle, text: "Data" });
  const resetBtn = titleRow.createEl("button", { cls: CSS.resetBtn, text: "Reset" });
  resetBtn.onclick = () => callbacks.onReset();

  const dataHint = section.createEl("p", { cls: CSS.dataHint });
  dataHint.hide();

  const folderRow = section.createDiv({ cls: CSS.row });
  folderRow.createEl("label", { text: "Folder" });
  const folderSelect = folderRow.createEl("select", { cls: "dropdown" });
  populateFolderSelect(folderSelect, config, collector);
  folderSelect.onchange = handle(async () => {
    const hadProperties = callbacks.getConfig().properties.some(Boolean);
    // A new folder has its own property names, so the old selection cannot carry over.
    callbacks.onConfigChange({
      folder: folderSelect.value,
      properties: [""],
      colors: [CHART_COLORS_HEX[0]],
    });
    callbacks.onRebuildPropertySelects();
    await callbacks.onRefresh();
    if (hadProperties) {
      dataHint.setText("Folder changed — please select a property.");
      dataHint.show();
    }
  });

  const propSection = section.createDiv({ cls: CSS.propSection });

  const addBtn = section.createEl("button", { text: "Add dataset", cls: CSS.addBtn });
  addBtn.onclick = () => {
    if (addBtn.getAttribute("aria-disabled") === "true") return;
    const { properties, colors } = callbacks.getConfig();
    callbacks.onConfigChange({
      properties: [...properties, ""],
      colors: [...colors, colorAt(colors, colors.length)],
    });
    callbacks.onRebuildPropertySelects();
  };

  return { folderSelect, propSection, dataHint, addBtn };
}

type VisualizationSectionRefs = Pick<
  ControlRefs,
  "typeBtns" | "heatmapHint" | "singleDatasetHint"
>;

function buildVisualizationSection(
  controls: HTMLElement,
  callbacks: ControlCallbacks
): VisualizationSectionRefs {
  const section = createSection(controls, "Visualization");

  // Single hint for all chart types that only support one dataset
  const singleDatasetHint = section.createDiv({ cls: CSS.hint });
  singleDatasetHint.id = SINGLE_DATASET_HINT_ID;
  singleDatasetHint.setText("Heatmap, pie, doughnut and polar area charts can only display one dataset at a time.");
  singleDatasetHint.hide();

  const heatmapHint = section.createDiv({ cls: CSS.hint });
  heatmapHint.hide();

  const typeBtns = new Map<ChartType, HTMLButtonElement>();

  /** One button per chart type; the active marking is applied by syncControlsToConfig. */
  const addTypeButton = (group: HTMLElement, type: ChartType): void => {
    const btn = group.createEl("button", { text: CHART_TYPE_LABELS[type], cls: CSS.toggleBtn });
    btn.onclick = handle(async () => {
      if (btn.getAttribute("aria-disabled") === "true") return;
      callbacks.onConfigChange({ type });
      callbacks.onControlsChanged();
      await callbacks.onRefresh();
    });
    typeBtns.set(type, btn);
  };

  // Row 1: Numeric / time-series types
  const trendRow = section.createDiv({ cls: CSS.row });
  trendRow.createEl("label", { text: "Numeric" });
  const trendGroup = trendRow.createDiv({ cls: CSS.btnGroup });
  for (const type of [...TREND_TYPES, "heatmap" as const]) {
    addTypeButton(trendGroup, type);
  }

  // Row 2: Distribution / text-property types
  const distRow = section.createDiv({ cls: CSS.row });
  distRow.createEl("label", { text: "Distribution" });
  const distGroup = distRow.createDiv({ cls: CSS.btnGroup });
  for (const type of DISTRIBUTION_TYPES) {
    addTypeButton(distGroup, type);
  }

  return { typeBtns, heatmapHint, singleDatasetHint };
}

function setButtonDisabled(btn: HTMLButtonElement, disabled: boolean, hintId?: string): void {
  btn.disabled = false;
  if (disabled) {
    btn.setAttribute("aria-disabled", "true");
    btn.setAttribute("tabindex", "0");
    if (hintId) btn.setAttribute("aria-describedby", hintId);
  } else {
    btn.removeAttribute("aria-disabled");
    btn.removeAttribute("tabindex");
    if (hintId) btn.removeAttribute("aria-describedby");
  }
  btn.toggleClass(CSS.btnDisabled, disabled);
}

export function updateHeatmapButton(
  refs: ControlRefs,
  activeDatasetCount: number,
  textPropertySelected = false,
  hasDates = true
): void {
  const disabledMulti = activeDatasetCount > 1;
  const disabled = disabledMulti || textPropertySelected || !hasDates;

  let title = "";
  if (disabledMulti) title = "Only available for a single dataset";
  else if (textPropertySelected) title = "Heatmap requires numeric or boolean values";
  else if (!hasDates) title = "Heatmap requires notes with dates in their filename or frontmatter";
  const heatmapBtn = refs.typeBtns.get("heatmap");
  if (heatmapBtn) {
    heatmapBtn.setAttribute("title", title);
    setButtonDisabled(heatmapBtn, disabled, SINGLE_DATASET_HINT_ID);
  }

  // The multi-dataset case already has its own hint, so only the data-shape reasons are
  // spelled out here.
  const showHint = !disabledMulti && (textPropertySelected || !hasDates);
  refs.heatmapHint.toggle(showHint);
  if (showHint) refs.heatmapHint.setText(title);
}

export function updateDistributionButtons(
  refs: ControlRefs,
  activeDatasetCount: number,
  activeType: ChartType,
  hasActiveProperty = true,
  /** False while a text property is drawn as a frequency chart, which ignores the range. */
  rangeApplies = true
): void {
  const multiDataset = activeDatasetCount > 1;
  for (const type of DISTRIBUTION_TYPES) {
    const btn = refs.typeBtns.get(type);
    if (!btn) continue;
    btn.setAttribute("title", multiDataset ? "Only available for a single dataset" : "");
    setButtonDisabled(btn, multiDataset, SINGLE_DATASET_HINT_ID);
  }

  const isSingleDatasetType = isDistributionType(activeType) || activeType === "heatmap";

  refs.singleDatasetHint.toggle(multiDataset);

  refs.addBtn.setAttribute(
    "title",
    isSingleDatasetType
      ? "Heatmap, pie, doughnut and polar area charts only support a single dataset"
      : ""
  );
  setButtonDisabled(refs.addBtn, isSingleDatasetType, SINGLE_DATASET_HINT_ID);

  // The range never shapes these charts, so showing its controls would imply otherwise.
  const rangeMatters =
    hasActiveProperty && rangeApplies && !isSingleDatasetType;
  refs.rangeSection.toggle(rangeMatters);
}

type RangeSectionRefs = Pick<
  ControlRefs,
  | "rangeSection"
  | "rangePresetBtns"
  | "customRangeBtn"
  | "showCustomRange"
  | "fromInput"
  | "toInput"
  | "dateError"
>;

function buildRangeSection(
  controls: HTMLElement,
  callbacks: ControlCallbacks,
): RangeSectionRefs {
  const section = createSection(controls, "Time range");

  const dateError = section.createDiv({ cls: CSS.dateError });
  dateError.hide();

  const presetRow = section.createDiv({ cls: CSS.row });
  presetRow.createEl("label", { text: "Preset" });
  const btnGroup = presetRow.createDiv({ cls: CSS.btnGroup });

  const rangePresetBtns = new Map<RangePreset, HTMLButtonElement>();
  for (const preset of ALL_RANGE_PRESETS) {
    const btn = btnGroup.createEl("button", {
      text: RANGE_PRESET_LABELS[preset],
      cls: CSS.toggleBtn,
    });
    btn.onclick = handle(async () => {
      callbacks.onConfigChange({ range: { preset } });
      callbacks.onControlsChanged();
      await callbacks.onRefresh();
    });
    rangePresetBtns.set(preset, btn);
  }

  const customRangeBtn = btnGroup.createEl("button", { text: "Custom", cls: CSS.toggleBtn });

  const fromRow = section.createDiv({ cls: CSS.row });
  fromRow.createEl("label", { text: "From" });
  const fromInput = fromRow.createEl("input", { type: "date", cls: CSS.dateInput });

  const toRow = section.createDiv({ cls: CSS.row });
  toRow.createEl("label", { text: "To" });
  const toInput = toRow.createEl("input", { type: "date", cls: CSS.dateInput });

  const applyRow = section.createDiv({ cls: `${CSS.row} ${CSS.rowEnd}` });
  const applyBtn = applyRow.createEl("button", { text: "Apply custom range", cls: CSS.toggleBtn });

  const showCustomRange = (visible: boolean) => {
    fromRow.toggle(visible);
    toRow.toggle(visible);
    applyRow.toggle(visible);
  };

  // Opening the custom rows is a UI state, not a config change: the range only changes
  // once both dates are filled in and applied.
  customRangeBtn.onclick = () => {
    for (const btn of rangePresetBtns.values()) btn.removeClass("active");
    customRangeBtn.addClass("active");
    showCustomRange(true);
  };

  applyBtn.onclick = handle(async () => {
    fromInput.removeClass("is-invalid");
    toInput.removeClass("is-invalid");
    const missingFrom = !fromInput.value;
    const missingTo = !toInput.value;
    if (missingFrom || missingTo) {
      if (missingFrom) fromInput.addClass("is-invalid");
      if (missingTo) toInput.addClass("is-invalid");
      dateError.setText("Please fill in both date fields.");
      dateError.show();
      return;
    }
    if (fromInput.value > toInput.value) {
      dateError.setText("The start date must be before the end date.");
      dateError.show();
      return;
    }
    callbacks.onConfigChange({ range: { from: fromInput.value, to: toInput.value } });
    callbacks.onControlsChanged();
    await callbacks.onRefresh();
  });

  return {
    rangeSection: section,
    rangePresetBtns,
    customRangeBtn,
    showCustomRange,
    fromInput,
    toInput,
    dateError,
  };
}

/** A copy of `values` with the entry at `index` replaced. */
function replaceAt(values: readonly string[], index: number, value: string): string[] {
  return values.map((existing, i) => (i === index ? value : existing));
}

function createSection(parent: HTMLElement, title: string): HTMLElement {
  const section = parent.createDiv({ cls: CSS.section });
  section.createDiv({ cls: CSS.sectionTitle, text: title });
  return section;
}

export function populateFolderSelect(
  select: HTMLSelectElement,
  config: ChartConfig,
  collector: DataCollector
): void {
  select.empty();
  select.createEl("option", { text: "— select folder —", value: "" });
  for (const folder of collector.getAllFolders()) {
    const opt = select.createEl("option", { text: folder, value: folder });
    if (folder === config.folder) opt.selected = true;
  }
}

export function rebuildPropertySelects(
  propSection: HTMLElement,
  config: ChartConfig,
  collector: DataCollector,
  callbacks: ControlCallbacks
): void {
  propSection.empty();

  const available = config.folder ? collector.getPropertiesInFolder(config.folder) : [];

  config.properties.forEach((_, i) => {
    const row = propSection.createDiv({ cls: CSS.row });
    row.createEl("label", { text: `Dataset ${i + 1}` });

    const colorId = `chart-color-${i}`;
    const colorInput = row.createEl("input", { type: "color", cls: CSS.colorInput });
    colorInput.id = colorId;
    colorInput.setAttribute("aria-label", `Color for dataset ${i + 1}`);
    colorInput.value = colorAt(config.colors, i);
    // Both events: oninput gives live feedback while dragging, onchange catches the
    // keyboard and paste paths that never fire oninput.
    const applyColor = handle(async () => {
      callbacks.onConfigChange({ colors: replaceAt(callbacks.getConfig().colors, i, colorInput.value) });
      await callbacks.onRefresh();
    });
    colorInput.oninput = applyColor;
    colorInput.onchange = applyColor;

    const propSelect = row.createEl("select", { cls: "dropdown" });
    propSelect.createEl("option", { text: "— select —", value: "" });
    for (const prop of available) {
      const opt = propSelect.createEl("option", { text: prop, value: prop });
      if (prop === config.properties[i]) opt.selected = true;
    }
    propSelect.onchange = handle(async () => {
      callbacks.onConfigChange({
        properties: replaceAt(callbacks.getConfig().properties, i, propSelect.value),
      });
      await callbacks.onRefresh();
    });

    if (i > 0) {
      const removeBtn = row.createEl("button", { text: "×", cls: CSS.removeBtn });
      removeBtn.setAttribute("aria-label", `Remove dataset ${i + 1}`);
      removeBtn.onclick = handle(async () => {
        const { properties, colors } = callbacks.getConfig();
        callbacks.onConfigChange({
          properties: properties.filter((_, k) => k !== i),
          colors: colors.filter((_, k) => k !== i),
        });
        callbacks.onRebuildPropertySelects();
        await callbacks.onRefresh();
      });
    } else {
      row.createSpan({ cls: CSS.btnSpacer });
    }
  });
}
