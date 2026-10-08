import {
  ControlCallbacks,
  ControlRefs,
  buildControls,
  rebuildPropertySelects,
  syncControlsToConfig,
} from "../src/ChartViewControls";
import { DataCollector } from "../src/DataCollector";
import { CHART_COLORS_HEX, ChartConfig } from "../src/types";
import { FakeElement, fakeElement, findByTag, findByText } from "./helpers/fakeElement";

/**
 * handle() reports a failing handler through console.error instead of letting it escape,
 * which would otherwise let a broken handler pass as a silent no-op here.
 */
let consoleError: jest.SpyInstance;

beforeEach(() => {
  consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

/**
 * These tests exist for one contract: the controls must never write the config. They
 * report a patch, and the view alone replaces its own state. Before that change the two
 * modules shared the same arrays and mutated them in place, so the order in which
 * handlers ran could change the outcome.
 */

function makeCollector(properties: string[], folders: string[] = ["/", "Daily"]): DataCollector {
  return {
    getAllFolders: () => folders,
    getPropertiesInFolder: () => properties,
  } as unknown as DataCollector;
}

interface Harness {
  root: FakeElement;
  /** The view's owned config, replaced on every reported patch. */
  config: () => ChartConfig;
  patches: Partial<ChartConfig>[];
  refreshCount: () => number;
  callbacks: ControlCallbacks;
  refs: ControlRefs;
  /** Applies a patch the way ChartView does for Reset, then re-renders the controls. */
  applyExternally: (patch: Partial<ChartConfig>) => void;
  activeTypes: () => string[];
  activeRanges: () => string[];
}

function setup(initial: Partial<ChartConfig> = {}, properties = ["mood", "sleep"]): Harness {
  let config: ChartConfig = {
    type: "line",
    folder: "Daily",
    properties: [""],
    colors: [CHART_COLORS_HEX[0]],
    dateFormat: "YYYY-MM-DD",
    range: { preset: "90d" },
    ...initial,
  };
  // Frozen, arrays included: a control that tried to write the config or push onto one
  // of its arrays would throw here rather than quietly succeed.
  const frozen = () => {
    Object.freeze(config.properties);
    Object.freeze(config.colors);
    Object.freeze(config.range);
    return Object.freeze(config);
  };
  const patches: Partial<ChartConfig>[] = [];
  let refreshCount = 0;

  let refs: ControlRefs;

  const callbacks: ControlCallbacks = {
    getConfig: () => frozen(),
    onConfigChange: (patch) => {
      patches.push(patch);
      // Exactly what ChartView.updateConfig does.
      config = { ...config, ...patch };
    },
    onRefresh: () => {
      refreshCount++;
      return Promise.resolve();
    },
    onRebuildPropertySelects: () => undefined,
    onControlsChanged: () => syncControlsToConfig(refs, frozen()),
    onReset: () => undefined,
  };

  const root = fakeElement();
  refs = buildControls(root as unknown as HTMLElement, makeCollector(properties), callbacks);

  const activeOf = (btns: Map<string, HTMLButtonElement>) =>
    [...btns.entries()]
      .filter(([, btn]) => (btn as unknown as FakeElement).hasClass("active"))
      .map(([key]) => key);

  return {
    root,
    refs,
    config: () => config,
    patches,
    refreshCount: () => refreshCount,
    callbacks,
    applyExternally: (patch) => {
      config = { ...config, ...patch };
      syncControlsToConfig(refs, frozen());
    },
    activeTypes: () => activeOf(refs.typeBtns as Map<string, HTMLButtonElement>),
    activeRanges: () => activeOf(refs.rangePresetBtns as Map<string, HTMLButtonElement>),
  };
}

/**
 * The bug these cover: the controls marked themselves active inside their own click
 * handlers, so a config change from anywhere else — Reset, or a default folder arriving
 * from the settings — updated the chart while the buttons kept showing the old choice.
 */
describe("rendering the config into the controls", () => {
  test("marks the configured type and range on build", () => {
    const h = setup({ type: "doughnut", range: { preset: "7d" } });

    expect(h.activeTypes()).toEqual(["doughnut"]);
    expect(h.activeRanges()).toEqual(["7d"]);
  });

  test("follows a change applied from outside the controls", () => {
    const h = setup({ type: "bar", range: { preset: "7d" } });

    h.applyExternally({ type: "pie", range: { preset: "all" } });

    expect(h.activeTypes()).toEqual(["pie"]);
    expect(h.activeRanges()).toEqual(["all"]);
  });

  test("a reset back to the defaults is reflected by every control", () => {
    const h = setup({ type: "heatmap", folder: "Other", range: { preset: "7d" } });

    // What ChartView.resetConfig() patches.
    h.applyExternally({
      type: "line",
      folder: "Daily",
      properties: [""],
      colors: [CHART_COLORS_HEX[0]],
      dateFormat: "YYYY-MM-DD",
      range: { preset: "90d" },
    });

    expect(h.activeTypes()).toEqual(["line"]);
    expect(h.activeRanges()).toEqual(["90d"]);
    expect(h.refs.folderSelect.value).toBe("Daily");
    expect((h.refs.customRangeBtn as unknown as FakeElement).hasClass("active")).toBe(false);
  });

  test("a custom range opens its rows and fills the date inputs", () => {
    const h = setup({ range: { preset: "90d" } });

    h.applyExternally({ range: { from: "2026-01-01", to: "2026-03-31" } });

    expect(h.activeRanges()).toEqual([]);
    expect((h.refs.customRangeBtn as unknown as FakeElement).hasClass("active")).toBe(true);
    expect(h.refs.fromInput.value).toBe("2026-01-01");
    expect(h.refs.toInput.value).toBe("2026-03-31");
  });

  test("switching back to a preset closes the custom rows", () => {
    const h = setup({ range: { from: "2026-01-01", to: "2026-03-31" } });
    expect((h.refs.fromInput as unknown as FakeElement).visible).toBe(true);

    h.applyExternally({ range: { preset: "30d" } });

    expect(h.activeRanges()).toEqual(["30d"]);
    expect(h.refs.fromInput.value).toBe("");
  });

  test("only ever one type is marked active", () => {
    const h = setup();
    for (const label of ["Bar", "Pie", "Heatmap", "Line"]) {
      findByText(h.root, label).onclick?.();
      expect(h.activeTypes()).toHaveLength(1);
    }
  });
});

describe("chart type buttons", () => {
  test("report the new type instead of writing it", () => {
    const h = setup();
    findByText(h.root, "Bar").onclick?.();

    expect(h.patches).toEqual([{ type: "bar" }]);
    expect(h.config().type).toBe("bar");
    expect(h.activeTypes()).toEqual(["bar"]);
  });

  test("a disabled button reports nothing", () => {
    const h = setup();
    const heatmap = findByText(h.root, "Heatmap");
    heatmap.setAttribute("aria-disabled", "true");
    heatmap.onclick?.();

    expect(h.patches).toEqual([]);
    expect(h.config().type).toBe("line");
  });
});

describe("range presets", () => {
  test("report a preset", () => {
    const h = setup();
    findByText(h.root, "7 days").onclick?.();

    expect(h.patches).toEqual([{ range: { preset: "7d" } }]);
  });

  test("a custom range needs both dates", () => {
    const h = setup({ range: {} });
    const [from, to] = findByTag(h.root, "input").filter((el) => el.type === "date");
    from.value = "2026-03-01";
    to.value = "";

    findByText(h.root, "Apply custom range").onclick?.();
    expect(h.patches).toEqual([]);

    to.value = "2026-03-31";
    findByText(h.root, "Apply custom range").onclick?.();
    expect(h.patches).toEqual([{ range: { from: "2026-03-01", to: "2026-03-31" } }]);
  });

  test("a reversed custom range is rejected", () => {
    const h = setup({ range: {} });
    const [from, to] = findByTag(h.root, "input").filter((el) => el.type === "date");
    from.value = "2026-03-31";
    to.value = "2026-03-01";

    findByText(h.root, "Apply custom range").onclick?.();
    expect(h.patches).toEqual([]);
  });
});

describe("adding and removing datasets", () => {
  test("add appends a property slot and a palette color", () => {
    const h = setup();
    findByText(h.root, "Add dataset").onclick?.();

    expect(h.config().properties).toEqual(["", ""]);
    expect(h.config().colors).toEqual([CHART_COLORS_HEX[0], CHART_COLORS_HEX[1]]);
  });

  test("add is ignored while disabled", () => {
    const h = setup();
    const add = findByText(h.root, "Add dataset");
    add.setAttribute("aria-disabled", "true");
    add.onclick?.();

    expect(h.patches).toEqual([]);
  });

  test("remove drops the matching property and color together", () => {
    const h = setup({ properties: ["mood", "sleep"], colors: ["#111111", "#222222"] });

    const propSection = fakeElement();
    rebuildPropertySelects(
      propSection as unknown as HTMLElement,
      h.config(),
      makeCollector(["mood", "sleep"]),
      h.callbacks
    );

    // Only rows after the first carry a remove button.
    findByText(propSection, "×").onclick?.();

    expect(h.config().properties).toEqual(["mood"]);
    expect(h.config().colors).toEqual(["#111111"]);
  });
});

describe("folder change", () => {
  test("resets the property selection, since names do not carry over", () => {
    const h = setup({ properties: ["mood", "sleep"], colors: ["#111111", "#222222"] });
    const select = findByTag(h.root, "select")[0];
    select.value = "Other";
    select.onchange?.();

    expect(h.config().folder).toBe("Other");
    expect(h.config().properties).toEqual([""]);
    expect(h.config().colors).toEqual([CHART_COLORS_HEX[0]]);
  });
});

describe("property and color selects", () => {
  function rebuilt(h: Harness) {
    const propSection = fakeElement();
    rebuildPropertySelects(
      propSection as unknown as HTMLElement,
      h.config(),
      makeCollector(["mood", "sleep"]),
      h.callbacks
    );
    return propSection;
  }

  test("a property select replaces only its own slot", () => {
    const h = setup({ properties: ["mood", "sleep"], colors: ["#111111", "#222222"] });
    const section = rebuilt(h);

    const selects = findByTag(section, "select");
    selects[1].value = "mood";
    selects[1].onchange?.();

    expect(h.config().properties).toEqual(["mood", "mood"]);
  });

  test("a color input replaces only its own slot", () => {
    const h = setup({ properties: ["mood", "sleep"], colors: ["#111111", "#222222"] });
    const section = rebuilt(h);

    const colorInputs = findByTag(section, "input").filter((el) => el.type === "color");
    colorInputs[0].value = "#abcdef";
    colorInputs[0].oninput?.();

    expect(h.config().colors).toEqual(["#abcdef", "#222222"]);
  });

  // The handlers are built once but run much later. Reading a captured config would
  // apply the patch to a stale snapshot and silently revert the change in between.
  test("handlers read the current config, not the one captured at build time", () => {
    const h = setup({ properties: ["mood", "sleep"], colors: ["#111111", "#222222"] });
    const section = rebuilt(h);

    // A change through a different control first.
    findByText(h.root, "Bar").onclick?.();

    const colorInputs = findByTag(section, "input").filter((el) => el.type === "color");
    colorInputs[1].value = "#333333";
    colorInputs[1].oninput?.();

    expect(h.config().type).toBe("bar");
    expect(h.config().colors).toEqual(["#111111", "#333333"]);
  });
});
