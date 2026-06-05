import { ChartRenderer } from "../src/ChartRenderer";
import { ChartConfig, Dataset } from "../src/types";
import moment from "moment";

(global as any).window = { moment };

// Minimal DOM stub used by ChartRenderer
function makeContainer(): HTMLElement {
  const canvas = {
    getContext: () => ({}),
    remove: jest.fn(),
  } as unknown as HTMLCanvasElement;

  return {
    createEl: jest.fn(() => canvas),
  } as unknown as HTMLElement;
}

function makeConfig(overrides: Partial<ChartConfig> = {}): ChartConfig {
  return {
    type: "line",
    folder: "Daily Notes",
    properties: ["mood"],
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
      value: v,
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
