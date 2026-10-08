import { ExportContext, buildCodeblock, yamlQuote } from "../src/codeblockExport";
import { ChartConfig, ChartType } from "../src/types";

function makeConfig(overrides: Partial<ChartConfig> = {}): ChartConfig {
  return {
    type: "line",
    folder: "Daily Notes",
    properties: ["mood"],
    colors: ["#6384FF"],
    dateFormat: "YYYY-MM-DD",
    range: { preset: "90d" },
    ...overrides,
  };
}

function makeContext(overrides: Partial<ExportContext> = {}): ExportContext {
  return { heatmapYear: 2026, segmentLabels: [], rangeApplies: true, ...overrides };
}

/** The block's body lines, without the opening and closing fences. */
function bodyLines(block: string): string[] {
  const lines = block.split("\n");
  return lines.slice(1, -1);
}

describe("yamlQuote", () => {
  test("wraps a plain value in double quotes", () => {
    expect(yamlQuote("mood")).toBe('"mood"');
  });

  test("escapes quotes and backslashes", () => {
    expect(yamlQuote('say "hi"')).toBe('"say \\"hi\\""');
    expect(yamlQuote("a\\b")).toBe('"a\\\\b"');
  });

  test("escapes newlines, carriage returns and tabs", () => {
    expect(yamlQuote("a\nb\rc\td")).toBe('"a\\nb\\rc\\td"');
  });

  test("quotes a value that YAML would otherwise read as a number", () => {
    expect(yamlQuote("2026")).toBe('"2026"');
  });
});

describe("buildCodeblock", () => {
  test("opens and closes with the property-chart fence", () => {
    const block = buildCodeblock(makeConfig(), makeContext());
    expect(block.split("\n")[0]).toBe("```property-chart");
    expect(block.endsWith("\n```")).toBe(true);
  });

  test("emits a single property and color as scalars", () => {
    const block = buildCodeblock(makeConfig(), makeContext());
    expect(bodyLines(block)).toEqual([
      "type: line",
      'folder: "Daily Notes"',
      'property: "mood"',
      'colors: "#6384FF"',
      "dateFormat: YYYY-MM-DD",
      "range: 90d",
    ]);
  });

  test("emits several properties and colors as YAML lists", () => {
    const block = buildCodeblock(
      makeConfig({ properties: ["mood", "sleep"], colors: ["#111111", "#222222"] }),
      makeContext()
    );
    expect(block).toContain('property:\n  - "mood"\n  - "sleep"');
    expect(block).toContain('colors:\n  - "#111111"\n  - "#222222"');
  });

  test("skips properties left unselected", () => {
    const block = buildCodeblock(
      makeConfig({ properties: ["mood", "", "sleep"], colors: ["#111111", "#222222", "#333333"] }),
      makeContext()
    );
    expect(block).toContain('property:\n  - "mood"\n  - "sleep"');
    // The color of the skipped dataset must be skipped with it, so colors stay aligned.
    expect(block).toContain('colors:\n  - "#111111"\n  - "#333333"');
  });

  test("falls back to the palette when a color was never set", () => {
    const block = buildCodeblock(makeConfig({ colors: [] }), makeContext());
    expect(block).toContain('colors: "#6384FF"');
  });

  describe("range", () => {
    test("exports a preset", () => {
      const block = buildCodeblock(makeConfig({ range: { preset: "7d" } }), makeContext());
      expect(block).toContain("range: 7d");
    });

    test("exports a custom from:to range", () => {
      const block = buildCodeblock(
        makeConfig({ range: { from: "2026-01-01", to: "2026-03-31" } }),
        makeContext()
      );
      expect(block).toContain("range: 2026-01-01:2026-03-31");
    });

    test("omits an incomplete custom range", () => {
      const block = buildCodeblock(makeConfig({ range: { from: "2026-01-01" } }), makeContext());
      expect(block).not.toContain("range:");
    });

    // A heatmap is bounded by its year and distribution types always collect every
    // note, so a stale preset would make the embed show less than the sidebar does.
    test.each<ChartType>(["heatmap", "pie", "doughnut", "polarArea"])(
      "omits range for %s",
      (type) => {
        const block = buildCodeblock(makeConfig({ type }), makeContext());
        expect(block).not.toContain("range:");
      }
    );

    test("omits range while a text property renders as a frequency chart", () => {
      const block = buildCodeblock(makeConfig(), makeContext({ rangeApplies: false }));
      expect(block).not.toContain("range:");
    });
  });

  describe("year", () => {
    test("is exported for a heatmap", () => {
      const block = buildCodeblock(makeConfig({ type: "heatmap" }), makeContext({ heatmapYear: 2024 }));
      expect(block).toContain("year: 2024");
    });

    test.each<ChartType>(["line", "bar", "pie", "doughnut", "polarArea"])(
      "is not exported for %s",
      (type) => {
        const block = buildCodeblock(makeConfig({ type }), makeContext());
        expect(block).not.toContain("year:");
      }
    );
  });

  describe("distribution colors", () => {
    test("map to segments rather than to datasets", () => {
      const block = buildCodeblock(
        makeConfig({ type: "pie", colors: ["#111111", "#222222", "#333333"] }),
        makeContext({ segmentLabels: ["work", "rest", "play"] })
      );
      expect(block).toContain('colors:\n  - "#111111"\n  - "#222222"\n  - "#333333"');
    });

    test("fall back to the palette for segments the user never recolored", () => {
      const block = buildCodeblock(
        makeConfig({ type: "pie", colors: ["#111111"] }),
        makeContext({ segmentLabels: ["work", "rest"] })
      );
      expect(block).toContain('colors:\n  - "#111111"\n  - "#FF6384"');
    });
  });

  test("round-trips every chart type", () => {
    const types: ChartType[] = ["line", "bar", "heatmap", "pie", "doughnut", "polarArea"];
    for (const type of types) {
      const block = buildCodeblock(makeConfig({ type }), makeContext({ segmentLabels: ["a"] }));
      expect(block).toContain(`type: ${type}`);
      expect(block.split("\n").filter((l) => l === "```")).toHaveLength(1);
    }
  });
});
