/**
 * Tests for CodeBlockProcessor
 *
 * Covers:
 * - US-06: YAML parsing, config building, range parsing
 * - Error handling for invalid/incomplete YAML
 */

import { CodeBlockProcessor } from "../src/CodeBlockProcessor";
import { DEFAULT_SETTINGS } from "../src/types";

// Minimal app mock — CodeBlockProcessor only uses app.metadataCache in process(),
// which we don't test here (requires DOM). buildConfig/parseRange are pure functions.
const mockApp = {
  metadataCache: {
    on: jest.fn(),
    offref: jest.fn(),
  },
  vault: {
    on: jest.fn(),
  },
} as any;

const processor = new CodeBlockProcessor(mockApp, DEFAULT_SETTINGS);

// ============================================================
// US-06: YAML Config Parsing
// ============================================================

describe("US-06: buildConfig — YAML config parsing", () => {
  test("parses a simple single-property config", () => {
    const config = processor.buildConfig({
      type: "line",
      folder: "Daily Notes",
      property: "sleep",
      dateFormat: "YYYY-MM-DD",
      range: "30d",
    });

    expect(config.type).toBe("line");
    expect(config.folder).toBe("Daily Notes");
    expect(config.properties).toEqual(["sleep"]);
    expect(config.dateFormat).toBe("YYYY-MM-DD");
    expect(config.range).toEqual({ preset: "30d" });
  });

  test("parses a multi-property config (array)", () => {
    const config = processor.buildConfig({
      type: "bar",
      folder: "Daily Notes",
      property: ["sleep", "mood"],
    });

    expect(config.properties).toEqual(["sleep", "mood"]);
  });

  test("falls back to plugin defaults when fields are omitted", () => {
    const config = processor.buildConfig({
      folder: "Daily Notes",
      property: "sleep",
    });

    expect(config.type).toBe(DEFAULT_SETTINGS.defaultChartType);
    expect(config.dateFormat).toBe(DEFAULT_SETTINGS.defaultDateFormat);
    expect(config.range).toEqual({ preset: DEFAULT_SETTINGS.defaultRange });
  });

  test("empty property field results in empty properties array", () => {
    const config = processor.buildConfig({ folder: "Daily Notes" });
    expect(config.properties).toEqual([]);
  });

  test("falls back to default folder when folder is omitted", () => {
    const config = processor.buildConfig({ property: "sleep" });
    expect(config.folder).toBe(DEFAULT_SETTINGS.defaultFolder);
  });
});

// ============================================================
// US-06: Range Parsing
// ============================================================

describe("US-06: parseRange — range string parsing", () => {
  test.each(["7d", "30d", "90d", "all"] as const)(
    "preset '%s' is parsed correctly",
    (preset) => {
      const range = processor.parseRange(preset);
      expect(range).toEqual({ preset });
    }
  );

  test("custom range 'YYYY-MM-DD:YYYY-MM-DD' is parsed into from/to", () => {
    const range = processor.parseRange("2024-01-01:2024-01-31");
    expect(range).toEqual({ from: "2024-01-01", to: "2024-01-31" });
  });

  test("undefined range falls back to default preset", () => {
    const range = processor.parseRange(undefined);
    expect(range).toEqual({ preset: DEFAULT_SETTINGS.defaultRange });
  });

  test("unrecognized string falls back to 30d", () => {
    const range = processor.parseRange("invalid");
    expect(range).toEqual({ preset: "30d" });
  });

  test("custom range with same from and to date is valid", () => {
    const range = processor.parseRange("2024-06-15:2024-06-15");
    expect(range).toEqual({ from: "2024-06-15", to: "2024-06-15" });
  });
});

// ============================================================
// US-06: Chart type validation
// ============================================================

describe("US-06: Chart type config", () => {
  test.each(["line", "bar", "scatter"] as const)(
    "chart type '%s' is accepted",
    (type) => {
      const config = processor.buildConfig({ type, folder: "Notes", property: "x" });
      expect(config.type).toBe(type);
    }
  );
});
