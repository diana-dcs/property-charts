/**
 * Tests for CodeBlockProcessor
 *
 * Covers:
 * - US-06: YAML parsing, config building, range parsing
 * - Security: injection, invalid input, boundary values
 * - Error handling for invalid/incomplete YAML
 */

import { CodeBlockProcessor } from "../src/CodeBlockProcessor";
import { DEFAULT_SETTINGS } from "../src/types";
import * as yaml from "js-yaml";

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

  test("normalizes user-defined folder paths", () => {
    const config = processor.buildConfig({ folder: "/Journal//Daily\\", property: "mood" });
    expect(config.folder).toBe("Journal/Daily");
  });

  test("keeps / as the vault root folder", () => {
    const config = processor.buildConfig({ folder: "/", property: "mood" });
    expect(config.folder).toBe("/");
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

  test("unrecognized string throws an error", () => {
    expect(() => processor.parseRange("invalid")).toThrow(/Invalid range/);
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
  test.each(["line", "bar", "heatmap"] as const)(
    "chart type '%s' is accepted",
    (type) => {
      const config = processor.buildConfig({ type, folder: "Notes", property: "x" });
      expect(config.type).toBe(type);
    }
  );

  test("invalid chart type throws an error", () => {
    expect(() =>
      processor.buildConfig({ type: "scatter" as any, folder: "Notes", property: "x" })
    ).toThrow(/Unknown chart type/);
  });
});

// ============================================================
// Security: YAML & Config Injection
// ============================================================

describe("Security: YAML schema enforcement", () => {
  test("js-yaml JSON_SCHEMA rejects !!js/function tags", () => {
    const maliciousYaml = `type: !!js/function 'function(){ return "pwned"; }'`;
    expect(() => yaml.load(maliciousYaml, { schema: yaml.JSON_SCHEMA })).toThrow();
  });

  test("__proto__ key in YAML does not pollute Object prototype", () => {
    yaml.load("__proto__:\n  isAdmin: true\n", { schema: yaml.JSON_SCHEMA });
    expect((({}) as any).isAdmin).toBeUndefined();
  });

  test("constructor key in YAML does not pollute prototype", () => {
    yaml.load("constructor:\n  prototype:\n    isAdmin: true\n", { schema: yaml.JSON_SCHEMA });
    expect((({}) as any).isAdmin).toBeUndefined();
  });
});

describe("Security: dateFormat sanitization", () => {
  test("valid format 'YYYY-MM-DD' is accepted unchanged", () => {
    const config = processor.buildConfig({ folder: "Notes", property: "x", dateFormat: "YYYY-MM-DD" });
    expect(config.dateFormat).toBe("YYYY-MM-DD");
  });

  test("format with regex metacharacters throws an error", () => {
    expect(() =>
      processor.buildConfig({ folder: "Notes", property: "x", dateFormat: "YYYY[.*+]{1,100}MM" })
    ).toThrow(/Invalid dateFormat/);
  });

  test("format with backticks or quotes throws an error", () => {
    expect(() =>
      processor.buildConfig({ folder: "Notes", property: "x", dateFormat: "YYYY`MM`DD" })
    ).toThrow(/Invalid dateFormat/);
  });
});

describe("Security: parseRange — malformed date strings", () => {
  test("non-date strings in custom range throw an error", () => {
    expect(() => processor.parseRange("not-a-date:also-bad")).toThrow(/Invalid dates in range/);
  });

  test("reversed range (from > to) is swapped automatically", () => {
    const range = processor.parseRange("2024-12-31:2024-01-01");
    expect(range).toEqual({ from: "2024-01-01", to: "2024-12-31" });
  });

  test("partial date string throws an error", () => {
    expect(() => processor.parseRange("2024-01:")).toThrow(/Invalid dates in range/);
  });
});

// ============================================================
// buildConfig: colors field, distribution types, heatmapYear
// ============================================================

describe("buildConfig — colors and distribution types", () => {
  test("colors omitted — default chart colors are assigned per property", () => {
    const config = processor.buildConfig({ folder: "Notes", property: ["a", "b"] });
    expect(config.colors).toHaveLength(2);
    config.colors.forEach((c) => expect(typeof c).toBe("string"));
  });

  test("colors provided as array — forwarded unchanged for distribution types", () => {
    const provided = ["#ff0000", "#00ff00", "#0000ff"];
    const config = processor.buildConfig({ type: "pie", folder: "Notes", property: "x", colors: provided });
    // Distribution type: raw colors are preserved as-is
    expect(config.colors).toEqual(provided);
  });

  test("colors as single string is wrapped into an array", () => {
    const config = processor.buildConfig({ folder: "Notes", property: "x", colors: "#aabbcc" as any });
    expect(config.colors[0]).toBe("#aabbcc");
  });

  test("heatmapYear defaults to current year when not provided", () => {
    const config = processor.buildConfig({ folder: "Notes", property: "x", type: "heatmap" });
    expect(config.heatmapYear).toBe(new Date().getFullYear());
  });

  test("heatmapYear is set when provided", () => {
    const config = processor.buildConfig({ folder: "Notes", property: "x", type: "heatmap", year: 2023 });
    expect(config.heatmapYear).toBe(2023);
  });
});

// ============================================================
// buildConfig: all valid chart types accepted
// ============================================================

describe("buildConfig — all chart types", () => {
  test.each(["line", "bar", "heatmap", "pie", "doughnut", "polarArea"] as const)(
    "chart type '%s' is accepted without throwing",
    (type) => {
      expect(() =>
        processor.buildConfig({ type, folder: "Notes", property: "x" })
      ).not.toThrow();
    }
  );
});

// ============================================================
// buildConfig: range edge cases at config level
// ============================================================

describe("buildConfig — range edge cases", () => {
  test("range 'all' results in preset: all", () => {
    const config = processor.buildConfig({ folder: "Notes", property: "x", range: "all" });
    expect(config.range).toEqual({ preset: "all" });
  });

  test("custom range string is passed through parseRange correctly", () => {
    const config = processor.buildConfig({ folder: "Notes", property: "x", range: "2024-01-01:2024-03-31" });
    expect(config.range).toEqual({ from: "2024-01-01", to: "2024-03-31" });
  });

  test("null range falls back to default preset", () => {
    const config = processor.buildConfig({ folder: "Notes", property: "x", range: null as any });
    expect(config.range).toEqual({ preset: DEFAULT_SETTINGS.defaultRange });
  });
});
