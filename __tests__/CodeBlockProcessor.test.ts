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
import { parseYaml } from "obsidian";

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

// Parsing is delegated to Obsidian's parseYaml, so the YAML schema is no longer ours
// to enforce. These tests cover buildConfig's own validation instead — the layer that
// has to treat every parsed field as untrusted.
describe("Security: config validation of untrusted fields", () => {
  test("a non-string type is rejected rather than cast through", () => {
    expect(() =>
      processor.buildConfig({ folder: "Notes", property: "x", type: { evil: true } })
    ).toThrow(/Unknown chart type/);
  });

  test("an object type is reported without '[object Object]' leaking into the message", () => {
    expect(() =>
      processor.buildConfig({ folder: "Notes", property: "x", type: { evil: true } })
    ).toThrow(/\{"evil":true\}/);
  });

  test("an object property name is stringified, never passed through as an object", () => {
    const config = processor.buildConfig({ folder: "Notes", property: { a: 1 } });
    expect(config.properties).toEqual(['{"a":1}']);
    expect(typeof config.properties[0]).toBe("string");
  });

  test("a non-numeric year is rejected", () => {
    expect(() =>
      processor.buildConfig({ folder: "Notes", property: "x", type: "heatmap", year: "not-a-year" })
    ).toThrow(/Invalid year/);
  });

  test("an out-of-range year is rejected", () => {
    expect(() =>
      processor.buildConfig({ folder: "Notes", property: "x", type: "heatmap", year: 12345 })
    ).toThrow(/Invalid year/);
  });

  test("a numeric string year is accepted and normalized to a number", () => {
    const config = processor.buildConfig({ folder: "Notes", property: "x", type: "heatmap", year: "2024" });
    expect(config.heatmapYear).toBe(2024);
  });

  test("a __proto__ key in the parsed config does not pollute Object prototype", () => {
    const polluted = JSON.parse('{"__proto__":{"isAdmin":true},"folder":"Notes","property":"x"}');
    processor.buildConfig(polluted);
    expect((({}) as any).isAdmin).toBeUndefined();
  });

  test("a constructor key in the parsed config does not pollute Object prototype", () => {
    const polluted = JSON.parse(
      '{"constructor":{"prototype":{"isAdmin":true}},"folder":"Notes","property":"x"}'
    );
    processor.buildConfig(polluted);
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

// ============================================================
// process(): a rejected config must always surface a message
// ============================================================

// Minimal element/context stubs — process() only needs the element-creation helpers.
function makeElement(): HTMLElement & { children: HTMLElement[]; text: string } {
  const el = {
    text: "",
    cls: "",
    children: [] as HTMLElement[],
    addClass: jest.fn(),
    empty: jest.fn(),
    isConnected: true,
    createEl: jest.fn((_tag: string, opts?: { text?: string; cls?: string }) => {
      const child = makeElement();
      child.text = opts?.text ?? "";
      child.cls = opts?.cls ?? "";
      el.children.push(child as unknown as HTMLElement);
      return child;
    }),
    createDiv: jest.fn(() => {
      const child = makeElement();
      el.children.push(child as unknown as HTMLElement);
      return child;
    }),
  };
  return el as unknown as HTMLElement & { children: HTMLElement[]; text: string };
}

const mockCtx = { addChild: jest.fn() } as any;

describe("process — invalid configs render an error instead of nothing", () => {
  beforeEach(() => {
    jest.mocked(parseYaml).mockReset();
  });

  // Regression: buildConfig() used to be called outside any try/catch, so a rejected
  // config threw out of process() and the code block rendered neither chart nor error.
  test.each([
    ["an unknown chart type", { folder: "Notes", property: "x", type: "bla" }, /Unknown chart type/],
    ["an invalid dateFormat", { folder: "Notes", property: "x", dateFormat: "¡¿*" }, /Invalid dateFormat/],
    ["an invalid range", { folder: "Notes", property: "x", range: "last-tuesday" }, /Invalid range/],
    ["an invalid year", { folder: "Notes", property: "x", type: "heatmap", year: "nope" }, /Invalid year/],
    ["year on a non-heatmap type", { folder: "Notes", property: "x", type: "line", year: 2024 }, /only applies to heatmaps/],
    ["an invalid color", { folder: "Notes", property: "x", colors: "bla" }, /Invalid color/],
  ])("reports %s", async (_label, parsed, expected) => {
    jest.mocked(parseYaml).mockReturnValue(parsed);
    const el = makeElement();

    await expect(processor.process("<stubbed>", el, mockCtx)).resolves.toBeUndefined();

    const messages = (el as any).children.map((c: any) => c.text).join("\n");
    expect(messages).toMatch(expected);
    expect(messages).toMatch(/Invalid chart configuration/);
  });

  test("a non-mapping YAML document reports a mapping error", async () => {
    jest.mocked(parseYaml).mockReturnValue(["not", "a", "mapping"]);
    const el = makeElement();

    await processor.process("<stubbed>", el, mockCtx);

    const messages = (el as any).children.map((c: any) => c.text).join("\n");
    expect(messages).toMatch(/must be a YAML mapping/);
  });

  test("a YAML parse failure reports the parser's message", async () => {
    jest.mocked(parseYaml).mockImplementation(() => {
      throw new Error("bad indentation");
    });
    const el = makeElement();

    await processor.process("<stubbed>", el, mockCtx);

    const messages = (el as any).children.map((c: any) => c.text).join("\n");
    expect(messages).toMatch(/Invalid YAML configuration: bad indentation/);
  });
});

// ============================================================
// buildConfig: colors, year and heatmap range defaults
// ============================================================

describe("buildConfig — color validation", () => {
  test.each([
    "#6384FF", "#fff", "#6384FFAA", "rgb(1,2,3)", "rgba(1, 2, 3, 0.5)",
    "hsl(120, 50%, 50%)", "red", "TRANSPARENT",
  ])("accepts %s", (color) => {
    const config = processor.buildConfig({ folder: "Notes", property: "x", colors: color });
    expect(config.colors[0]).toBe(color);
  });

  test.each(["bla", "#12", "#gggggg", "123456", "rgb(", "  "])("rejects %s", (color) => {
    expect(() =>
      processor.buildConfig({ folder: "Notes", property: "x", colors: color })
    ).toThrow(/Invalid color/);
  });

  test("the offending color is named in the message, not just the first one", () => {
    expect(() =>
      processor.buildConfig({ folder: "Notes", property: ["a", "b"], colors: ["#fff", "nope"] })
    ).toThrow(/Invalid color "nope"/);
  });
});

describe("buildConfig — year is heatmap-only", () => {
  test.each(["line", "bar", "pie", "doughnut", "polarArea"])(
    "year is rejected for type %s",
    (type) => {
      expect(() =>
        processor.buildConfig({ folder: "Notes", property: "x", type, year: 2024 })
      ).toThrow(/only applies to heatmaps/);
    }
  );

  test("year is accepted for heatmap", () => {
    const config = processor.buildConfig({
      folder: "Notes", property: "x", type: "heatmap", year: 2024,
    });
    expect(config.heatmapYear).toBe(2024);
  });
});

describe("buildConfig — heatmap range defaults to the displayed year", () => {
  // Regression: the default preset (90d) used to survive into the heatmap, which dims
  // every cell outside it — so setting `year:` appeared to do nothing.
  test("without an explicit range the year's bounds are used", () => {
    const config = processor.buildConfig({
      folder: "Notes", property: "x", type: "heatmap", year: 2024,
    });
    expect(config.range).toEqual({ from: "2024-01-01", to: "2024-12-31" });
  });

  test("an explicit range still wins", () => {
    const config = processor.buildConfig({
      folder: "Notes", property: "x", type: "heatmap", year: 2024, range: "30d",
    });
    expect(config.range).toEqual({ preset: "30d" });
  });

  test("non-heatmap types keep the default preset", () => {
    const config = processor.buildConfig({ folder: "Notes", property: "x", type: "line" });
    expect(config.range).toEqual({ preset: DEFAULT_SETTINGS.defaultRange });
  });
});

describe("buildConfig — a bare `year:` carries no value but still signals intent", () => {
  // `year:` with nothing after it parses to null. On a heatmap that means "current
  // year"; on any other type it is still a misconception worth reporting.
  test("a bare year on a heatmap falls back to the current year", () => {
    const config = processor.buildConfig({
      folder: "Notes", property: "x", type: "heatmap", year: null,
    });
    expect(config.heatmapYear).toBe(new Date().getFullYear());
  });

  test("a bare year on a heatmap matches omitting it entirely", () => {
    const bare = processor.buildConfig({
      folder: "Notes", property: "x", type: "heatmap", year: null,
    });
    const omitted = processor.buildConfig({ folder: "Notes", property: "x", type: "heatmap" });
    expect(bare).toEqual(omitted);
  });

  test("a bare year on a non-heatmap type is rejected, just like an explicit one", () => {
    expect(() =>
      processor.buildConfig({ folder: "Notes", property: "x", type: "line", year: null })
    ).toThrow(/only applies to heatmaps/);
  });
});
