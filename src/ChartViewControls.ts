import {
  ALL_RANGE_PRESETS,
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
  heatmapBtn: HTMLButtonElement;
  heatmapHint: HTMLElement;
  singleDatasetHint: HTMLElement;
  distributionBtns: Map<ChartType, HTMLButtonElement>;
  rangeSection: HTMLElement;
}

export interface ControlCallbacks {
  onRefresh: () => Promise<void>;
  onRebuildPropertySelects: () => void;
  onReset: () => void;
}

export function buildControls(
  root: HTMLElement,
  config: ChartConfig,
  collector: DataCollector,
  callbacks: ControlCallbacks
): ControlRefs {
  const controls = root.createDiv({ cls: CSS.controls });

  return {
    ...buildDataSection(controls, config, collector, callbacks),
    ...buildVisualizationSection(controls, config, callbacks),
    rangeSection: buildRangeSection(controls, config, callbacks),
  };
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
    const hadProperties = config.properties.some(Boolean);
    config.folder = folderSelect.value;
    config.properties.length = 0;
    config.properties.push("");
    config.colors.length = 0;
    config.colors.push(CHART_COLORS_HEX[0]);
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
    config.properties.push("");
    config.colors.push(colorAt(config.colors, config.colors.length));
    callbacks.onRebuildPropertySelects();
  };

  return { folderSelect, propSection, dataHint, addBtn };
}

type VisualizationSectionRefs = Pick<
  ControlRefs,
  "heatmapBtn" | "heatmapHint" | "singleDatasetHint" | "distributionBtns"
>;

function buildVisualizationSection(
  controls: HTMLElement,
  config: ChartConfig,
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

  // All type buttons share one "clear active" operation via this array.
  const allTypeBtns: HTMLButtonElement[] = [];
  const clearActive = () => allTypeBtns.forEach((b) => b.removeClass("active"));

  // Row 1: Numeric / time-series types
  const trendRow = section.createDiv({ cls: CSS.row });
  trendRow.createEl("label", { text: "Numeric" });
  const trendGroup = trendRow.createDiv({ cls: CSS.btnGroup });

  TREND_TYPES.forEach((t) => {
    const btn = trendGroup.createEl("button", { text: CHART_TYPE_LABELS[t], cls: CSS.toggleBtn });
    if (t === config.type) btn.addClass("active");
    btn.onclick = handle(async () => {
      config.type = t;
      clearActive();
      btn.addClass("active");
      await callbacks.onRefresh();
    });
    allTypeBtns.push(btn);
  });

  const heatmapBtn = trendGroup.createEl("button", { text: CHART_TYPE_LABELS["heatmap"], cls: CSS.toggleBtn });
  if (config.type === "heatmap") heatmapBtn.addClass("active");
  heatmapBtn.onclick = handle(async () => {
    if (heatmapBtn.getAttribute("aria-disabled") === "true") return;
    config.type = "heatmap";
    clearActive();
    heatmapBtn.addClass("active");
    await callbacks.onRefresh();
  });
  allTypeBtns.push(heatmapBtn);

  // Row 2: Distribution / text-property types
  const distRow = section.createDiv({ cls: CSS.row });
  distRow.createEl("label", { text: "Distribution" });
  const distGroup = distRow.createDiv({ cls: CSS.btnGroup });

  const distributionBtns = new Map<ChartType, HTMLButtonElement>();
  DISTRIBUTION_TYPES.forEach((t) => {
    const btn = distGroup.createEl("button", { text: CHART_TYPE_LABELS[t], cls: CSS.toggleBtn });
    if (t === config.type) btn.addClass("active");
    btn.onclick = handle(async () => {
      if (btn.getAttribute("aria-disabled") === "true") return;
      config.type = t;
      clearActive();
      btn.addClass("active");
      await callbacks.onRefresh();
    });
    allTypeBtns.push(btn);
    distributionBtns.set(t, btn);
  });

  return { heatmapBtn, heatmapHint, singleDatasetHint, distributionBtns };
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
  refs.heatmapBtn.setAttribute("title", title);
  setButtonDisabled(refs.heatmapBtn, disabled, SINGLE_DATASET_HINT_ID);

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
  for (const btn of refs.distributionBtns.values()) {
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

function buildRangeSection(
  controls: HTMLElement,
  config: ChartConfig,
  callbacks: ControlCallbacks,
): HTMLElement {
  const section = createSection(controls, "Time range");

  const dateError = section.createDiv({ cls: CSS.dateError });
  dateError.hide();

  const presetRow = section.createDiv({ cls: CSS.row });
  presetRow.createEl("label", { text: "Preset" });
  const btnGroup = presetRow.createDiv({ cls: CSS.btnGroup });

  const isCustomActive = !config.range.preset;

  ALL_RANGE_PRESETS.forEach((r) => {
    const btn = btnGroup.createEl("button", { text: RANGE_PRESET_LABELS[r], cls: CSS.toggleBtn });
    if (config.range.preset === r) btn.addClass("active");
    btn.onclick = handle(async () => {
      config.range = { preset: r };
      btnGroup.querySelectorAll("button").forEach((b) => b.removeClass("active"));
      btn.addClass("active");
      customBtn.removeClass("active");
      setCustomRowsVisible(false);
      dateError.hide();
      await callbacks.onRefresh();
    });
  });

  const customBtn = btnGroup.createEl("button", { text: "Custom", cls: CSS.toggleBtn });
  if (isCustomActive) customBtn.addClass("active");
  customBtn.onclick = () => {
    btnGroup.querySelectorAll("button").forEach((b) => b.removeClass("active"));
    customBtn.addClass("active");
    setCustomRowsVisible(true);
  };

  const fromRow = section.createDiv({ cls: CSS.row });
  fromRow.createEl("label", { text: "From" });
  const fromInput = fromRow.createEl("input", { type: "date", cls: CSS.dateInput });
  if (config.range.from) fromInput.value = config.range.from;

  const toRow = section.createDiv({ cls: CSS.row });
  toRow.createEl("label", { text: "To" });
  const toInput = toRow.createEl("input", { type: "date", cls: CSS.dateInput });
  if (config.range.to) toInput.value = config.range.to;

  const applyRow = section.createDiv({ cls: `${CSS.row} ${CSS.rowEnd}` });
  const applyBtn = applyRow.createEl("button", { text: "Apply custom range", cls: CSS.toggleBtn });

  const setCustomRowsVisible = (visible: boolean) => {
    fromRow.toggle(visible);
    toRow.toggle(visible);
    applyRow.toggle(visible);
  };

  // Show custom fields only when no preset is active (custom range is already set)
  setCustomRowsVisible(isCustomActive);

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
    dateError.hide();
    config.range = { from: fromInput.value, to: toInput.value };
    btnGroup.querySelectorAll("button").forEach((b) => b.removeClass("active"));
    customBtn.addClass("active");
    await callbacks.onRefresh();
  });

  return section;
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
      config.colors[i] = colorInput.value;
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
      config.properties[i] = propSelect.value;
      await callbacks.onRefresh();
    });

    if (i > 0) {
      const removeBtn = row.createEl("button", { text: "×", cls: CSS.removeBtn });
      removeBtn.setAttribute("aria-label", `Remove dataset ${i + 1}`);
      removeBtn.onclick = handle(async () => {
        config.properties.splice(i, 1);
        config.colors.splice(i, 1);
        callbacks.onRebuildPropertySelects();
        await callbacks.onRefresh();
      });
    } else {
      row.createSpan({ cls: CSS.btnSpacer });
    }
  });
}
