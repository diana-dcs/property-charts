import { ChartRenderer } from "../src/ChartRenderer";
import { ChartConfig, Dataset } from "../src/types";
import { Chart } from "chart.js/auto";
import moment from "moment";

/** The config the renderer handed to Chart.js, as the mock recorded it. */
function lastChartConfig(): { type: string; data: { labels: string[]; datasets: { data: unknown[] }[] } } {
  return (Chart as unknown as { lastConfig: any }).lastConfig;
}

// Some chart types read Obsidian CSS variables from the DOM at render time.
// Provide minimal stubs so the node test environment does not throw.
beforeAll(() => {
  (global as any).document = { body: {} };
  (global as any).getComputedStyle = () => ({
    getPropertyValue: () => "#333",
  });
});
afterAll(() => {
  delete (global as any).document;
  delete (global as any).getComputedStyle;
});

// Minimal DOM stub used by ChartRenderer
function makeContainer(): HTMLElement {
  const canvas = {
    getContext: () => ({}),
    remove: jest.fn(),
  } as unknown as HTMLCanvasElement;

  return {
    createEl: jest.fn(() => canvas),
    addClass: jest.fn(),
    removeClass: jest.fn(),
    setCssProps: jest.fn(),
  } as unknown as HTMLElement;
}

function makeConfig(overrides: Partial<ChartConfig> = {}): ChartConfig {
  return {
    type: "line",
    folder: "Daily Notes",
    properties: ["mood"],
    colors: [],
    dateFormat: "YYYY-MM-DD",
    range: { preset: "all" },
    ...overrides,
  };
}

function makeDataset(property: string, values: number[], dates: string[]): Dataset {
  return {
    property,
    valueType: "number",
    points: values.map((v, i) => ({
      date: moment(dates[i], "YYYY-MM-DD").toDate(),
      label: dates[i],
      value: v,
      rawValue: v,
    })),
  };
}

/**
 * A checkbox dataset as DataCollector produces it: one point per note in the folder,
 * including the unticked ones.
 */
function makeCheckboxDataset(property: string, values: boolean[]): Dataset {
  return {
    property,
    valueType: "boolean",
    points: values.map((v, i) => ({
      date: null,
      label: `note-${i}`,
      value: v ? 1 : 0,
      rawValue: v,
    })),
  };
}

function makeTextDataset(property: string, values: string[], dates: string[]): Dataset {
  return {
    property,
    valueType: "text",
    points: values.map((v, i) => ({
      date: moment(dates[i], "YYYY-MM-DD").toDate(),
      label: dates[i],
      value: v,
      rawValue: v,
    })),
  };
}

describe("ChartRenderer", () => {
  describe("render — time series", () => {
    it("renders a line chart without throwing", async () => {
      const container = makeContainer();
      const renderer = new ChartRenderer(container);
      const config = makeConfig({ type: "line" });
      const datasets = [makeDataset("mood", [7, 8, 6], ["2024-01-10", "2024-01-11", "2024-01-12"])];
      await expect(renderer.render(config, datasets)).resolves.toBeUndefined();
    });

    it("renders a bar chart without throwing", async () => {
      const container = makeContainer();
      const renderer = new ChartRenderer(container);
      const config = makeConfig({ type: "bar" });
      const datasets = [makeDataset("sleep", [7, 8], ["2024-01-10", "2024-01-11"])];
      await expect(renderer.render(config, datasets)).resolves.toBeUndefined();
    });

    it("renders multiple datasets without throwing", async () => {
      const container = makeContainer();
      const renderer = new ChartRenderer(container);
      const config = makeConfig({ properties: ["mood", "sleep"] });
      const datasets = [
        makeDataset("mood", [7, 8], ["2024-01-10", "2024-01-11"]),
        makeDataset("sleep", [6, 7], ["2024-01-10", "2024-01-11"]),
      ];
      await expect(renderer.render(config, datasets)).resolves.toBeUndefined();
    });
  });

  describe("render — frequency chart", () => {
    it("renders a single text dataset without throwing", async () => {
      const container = makeContainer();
      const renderer = new ChartRenderer(container);
      const config = makeConfig({ type: "bar" });
      const datasets = [makeTextDataset("mood", ["good", "bad", "good"], ["2024-01-10", "2024-01-11", "2024-01-12"])];
      await expect(renderer.render(config, datasets)).resolves.toBeUndefined();
    });

    it("renders multiple text datasets combining all labels", async () => {
      const container = makeContainer();
      const renderer = new ChartRenderer(container);
      const config = makeConfig({ properties: ["mood", "energy"] });
      const datasets = [
        makeTextDataset("mood", ["good", "bad"], ["2024-01-10", "2024-01-11"]),
        makeTextDataset("energy", ["high", "good"], ["2024-01-10", "2024-01-11"]),
      ];
      await expect(renderer.render(config, datasets)).resolves.toBeUndefined();
    });
  });

  describe("render — distribution charts", () => {
    it.each(["pie", "doughnut", "polarArea"] as const)(
      "renders a %s chart without throwing",
      async (type) => {
        const container = makeContainer();
        const renderer = new ChartRenderer(container);
        const config = makeConfig({ type });
        const datasets = [makeDataset("mood", [3, 5, 2], ["2024-01-10", "2024-01-11", "2024-01-12"])];
        await expect(renderer.render(config, datasets)).resolves.toBeUndefined();
      }
    );

    it("renders a distribution chart with multiple datasets without throwing", async () => {
      const container = makeContainer();
      const renderer = new ChartRenderer(container);
      const config = makeConfig({ type: "pie", properties: ["mood", "sleep"] });
      const datasets = [
        makeDataset("mood", [7, 8, 6], ["2024-01-10", "2024-01-11", "2024-01-12"]),
        makeDataset("sleep", [6, 7, 8], ["2024-01-10", "2024-01-11", "2024-01-12"]),
      ];
      await expect(renderer.render(config, datasets)).resolves.toBeUndefined();
    });
  });

  describe("render — heatmap", () => {
    it("returns early without throwing for all-text heatmap datasets", async () => {
      const container = makeContainer();
      const renderer = new ChartRenderer(container);
      const config = makeConfig({ type: "heatmap" });
      const datasets = [makeTextDataset("mood", ["good", "bad"], ["2024-01-10", "2024-01-11"])];
      await expect(renderer.render(config, datasets)).resolves.toBeUndefined();
    });
  });

  describe("destroy", () => {
    it("can be called before render without throwing", () => {
      const container = makeContainer();
      const renderer = new ChartRenderer(container);
      expect(() => renderer.destroy()).not.toThrow();
    });

    it("can be called multiple times without throwing", async () => {
      const container = makeContainer();
      const renderer = new ChartRenderer(container);
      const config = makeConfig();
      const datasets = [makeDataset("mood", [7], ["2024-01-10"])];
      await renderer.render(config, datasets);
      expect(() => {
        renderer.destroy();
        renderer.destroy();
      }).not.toThrow();
    });
  });
});

describe("ChartRenderer — checkbox properties", () => {
  it("draws a pie with the fixed Checked/Unchecked pair", async () => {
    const renderer = new ChartRenderer(makeContainer());
    const config = makeConfig({ type: "pie", properties: ["done"] });
    await renderer.render(config, [
      makeCheckboxDataset("done", [true, true, false, false, false]),
    ]);

    const cfg = lastChartConfig();
    expect(cfg.data.labels).toEqual(["Checked", "Unchecked"]);
    expect(cfg.data.datasets[0].data).toEqual([2, 3]);
  });

  // The regression this guards: an all-true folder used to render a single 100% segment.
  it("keeps an empty Unchecked segment when every note is ticked", async () => {
    const renderer = new ChartRenderer(makeContainer());
    const config = makeConfig({ type: "doughnut", properties: ["done"] });
    await renderer.render(config, [makeCheckboxDataset("done", [true, true])]);

    const cfg = lastChartConfig();
    expect(cfg.data.labels).toEqual(["Checked", "Unchecked"]);
    expect(cfg.data.datasets[0].data).toEqual([2, 0]);
  });

  it("draws a bar chart as a frequency chart, not as a 0/1 time series", async () => {
    const renderer = new ChartRenderer(makeContainer());
    const config = makeConfig({ type: "bar", properties: ["done"] });
    await renderer.render(config, [makeCheckboxDataset("done", [true, false, false])]);

    const cfg = lastChartConfig();
    expect(cfg.data.labels).toEqual(["Checked", "Unchecked"]);
    expect(cfg.data.datasets[0].data).toEqual([1, 2]);
  });
});
