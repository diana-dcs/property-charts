import { ChartConfig, ChartType, CHART_COLORS_HEX, CSS, RangePreset } from "./types";
import { DataCollector } from "./DataCollector";

export interface ControlRefs {
  folderSelect: HTMLSelectElement;
  propSection: HTMLElement;
  heatmapBtn?: HTMLButtonElement;
  heatmapHint?: HTMLElement;
}

export interface ControlCallbacks {
  onRefresh: () => Promise<void>;
  onRebuildPropertySelects: () => void;
  onCopyCodeblock: (btn: HTMLButtonElement) => void;
}

export function buildControls(
  root: HTMLElement,
  config: ChartConfig,
  datasets: string[],
  collector: DataCollector,
  callbacks: ControlCallbacks
): ControlRefs {
  const controls = root.createDiv({ cls: CSS.controls });
  const refs = {} as ControlRefs;

  buildDataSection(controls, config, datasets, collector, refs, callbacks);
  buildVisualizationSection(controls, config, callbacks, refs);
  buildRangeSection(controls, config, callbacks);

  return refs;
}

function buildDataSection(
  controls: HTMLElement,
  config: ChartConfig,
  datasets: string[],
  collector: DataCollector,
  refs: ControlRefs,
  callbacks: ControlCallbacks
): void {
  const section = createSection(controls, "Data");

  const folderRow = section.createDiv({ cls: CSS.row });
  folderRow.createEl("label", { text: "Folder" });
  refs.folderSelect = folderRow.createEl("select", { cls: "dropdown" });
  populateFolderSelect(refs.folderSelect, config, collector);
  refs.folderSelect.onchange = async () => {
    config.folder = refs.folderSelect.value;
    datasets.length = 0;
    datasets.push("");
    config.properties.length = 0;
    config.properties.push("");
    config.colors.length = 0;
    config.colors.push(CHART_COLORS_HEX[0]);
    callbacks.onRebuildPropertySelects();
    await callbacks.onRefresh();
  };

  refs.propSection = section.createDiv({ cls: CSS.propSection });

  const addBtn = section.createEl("button", { text: "+ Dataset", cls: CSS.addBtn });
  addBtn.onclick = () => {
    datasets.push("");
    config.properties.push("");
    config.colors.push(CHART_COLORS_HEX[config.colors.length % CHART_COLORS_HEX.length]);
    callbacks.onRebuildPropertySelects();
  };
}

function buildVisualizationSection(
  controls: HTMLElement,
  config: ChartConfig,
  callbacks: ControlCallbacks,
  refs: ControlRefs
): void {
  const section = createSection(controls, "Visualization");
  const row = section.createDiv({ cls: CSS.row });
  row.createEl("label", { text: "Type" });
  const btnGroup = row.createDiv({ cls: CSS.btnGroup });

  (["line", "bar"] as ChartType[]).forEach((t) => {
    const btn = btnGroup.createEl("button", { text: t, cls: CSS.toggleBtn });
    if (t === config.type) btn.addClass("active");
    btn.onclick = async () => {
      config.type = t;
      btnGroup.querySelectorAll("button").forEach((b) => b.removeClass("active"));
      btn.addClass("active");
      await callbacks.onRefresh();
    };
  });

  const heatmapBtn = btnGroup.createEl("button", { text: "heatmap", cls: CSS.toggleBtn });
  if (config.type === "heatmap") heatmapBtn.addClass("active");
  heatmapBtn.setAttribute("title", "");
  heatmapBtn.onclick = async () => {
    if (heatmapBtn.disabled) return;
    config.type = "heatmap";
    btnGroup.querySelectorAll("button").forEach((b) => b.removeClass("active"));
    heatmapBtn.addClass("active");
    await callbacks.onRefresh();
  };
  refs.heatmapBtn = heatmapBtn;

  // Hint rendered below the type row, spanning the full section width.
  // Shown whenever heatmap is the active type.
  const hint = section.createDiv();
  hint.style.cssText =
    "display:none; font-size:0.78em; color:var(--text-muted); " +
    "padding:4px 0 2px; line-height:1.4;";
  hint.setText("Heatmap can only display one dataset at a time.");
  refs.heatmapHint = hint;
}

export function updateHeatmapButton(
  refs: ControlRefs,
  activeDatasetCount: number,
  activeType: ChartType
): void {
  const btn = refs.heatmapBtn;
  if (!btn) return;
  const disabled = activeDatasetCount > 1;
  btn.disabled = disabled;
  btn.setAttribute("title", disabled ? "Only for a single dataset" : "");
  btn.style.opacity = disabled ? "0.45" : "";
  btn.style.cursor = disabled ? "not-allowed" : "";

  if (refs.heatmapHint) {
    refs.heatmapHint.style.display = activeType === "heatmap" ? "block" : "none";
  }
}

function buildRangeSection(
  controls: HTMLElement,
  config: ChartConfig,
  callbacks: ControlCallbacks
): void {
  const section = createSection(controls, "Time Range");

  const presetRow = section.createDiv({ cls: CSS.row });
  presetRow.createEl("label", { text: "Preset" });
  const btnGroup = presetRow.createDiv({ cls: CSS.btnGroup });

  (["7d", "30d", "90d", "all"] as RangePreset[]).forEach((r) => {
    const btn = btnGroup.createEl("button", { text: r, cls: CSS.toggleBtn });
    if (config.range.preset === r) btn.addClass("active");
    btn.onclick = async () => {
      config.range = { preset: r };
      btnGroup.querySelectorAll("button").forEach((b) => b.removeClass("active"));
      btn.addClass("active");
      await callbacks.onRefresh();
    };
  });

  const fromRow = section.createDiv({ cls: CSS.row });
  fromRow.createEl("label", { text: "From" });
  const fromInput = fromRow.createEl("input", { type: "date", cls: CSS.dateInput });

  const toRow = section.createDiv({ cls: CSS.row });
  toRow.createEl("label", { text: "To" });
  const toInput = toRow.createEl("input", { type: "date", cls: CSS.dateInput });

  const applyRow = section.createDiv({ cls: `${CSS.row} ${CSS.rowEnd}` });
  const dateError = applyRow.createEl("span", { cls: CSS.dateError });
  dateError.style.display = "none";

  const applyBtn = applyRow.createEl("button", { text: "Apply custom range", cls: CSS.toggleBtn });
  applyBtn.onclick = async () => {
    if (fromInput.value && toInput.value) {
      if (fromInput.value > toInput.value) {
        dateError.setText("'From' must be before 'To'.");
        dateError.style.display = "";
        return;
      }
      dateError.style.display = "none";
      config.range = { from: fromInput.value, to: toInput.value };
      btnGroup.querySelectorAll("button").forEach((b) => b.removeClass("active"));
      await callbacks.onRefresh();
    }
  };
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
  datasets: string[],
  callbacks: ControlCallbacks
): void {
  propSection.empty();

  const available = config.folder ? collector.getPropertiesInFolder(config.folder) : [];

  datasets.forEach((_, i) => {
    const row = propSection.createDiv({ cls: CSS.row });
    row.createEl("label", { text: i === 0 ? "Property" : `+ ${i + 1}` });

    const colorInput = row.createEl("input", { type: "color", cls: CSS.colorInput });
    colorInput.value = config.colors[i] ?? CHART_COLORS_HEX[i % CHART_COLORS_HEX.length];
    const applyColor = async () => {
      config.colors[i] = colorInput.value;
      await callbacks.onRefresh();
    };
    colorInput.oninput = applyColor;
    colorInput.onchange = applyColor;

    const propSelect = row.createEl("select", { cls: "dropdown" });
    propSelect.createEl("option", { text: "— select —", value: "" });
    for (const prop of available) {
      const opt = propSelect.createEl("option", { text: prop, value: prop });
      if (prop === config.properties[i]) opt.selected = true;
    }
    propSelect.onchange = async () => {
      config.properties[i] = propSelect.value;
      await callbacks.onRefresh();
    };

    if (i > 0) {
      const removeBtn = row.createEl("button", { text: "×", cls: CSS.removeBtn });
      removeBtn.onclick = async () => {
        datasets.splice(i, 1);
        config.properties.splice(i, 1);
        config.colors.splice(i, 1);
        callbacks.onRebuildPropertySelects();
        await callbacks.onRefresh();
      };
    } else {
      const spacer = row.createEl("span");
      spacer.style.cssText = "display:inline-block; visibility:hidden; flex-shrink:0; width:22px;";
    }
  });
}
