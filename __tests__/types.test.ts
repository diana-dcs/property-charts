import {
  CHART_COLORS_HEX,
  DataPoint,
  Dataset,
  PropertyValueType,
  colorAt,
  countValueFrequencies,
  isDistributionType,
  isInFolder,
  isTextDatasets,
  yearRange,
} from "../src/types";

function point(rawValue: unknown): DataPoint {
  return { date: null, label: "note", value: null, rawValue };
}

function dataset(valueType: PropertyValueType, pointCount: number): Dataset {
  return {
    property: "p",
    valueType,
    points: Array.from({ length: pointCount }, () => point("x")),
  };
}

describe("colorAt", () => {
  test("prefers the user's color", () => {
    expect(colorAt(["#abcdef"], 0)).toBe("#abcdef");
  });

  test("falls back to the palette past the end of the list", () => {
    expect(colorAt(["#abcdef"], 1)).toBe(CHART_COLORS_HEX[1]);
  });

  test("falls back when no colors were set at all", () => {
    expect(colorAt(undefined, 0)).toBe(CHART_COLORS_HEX[0]);
    expect(colorAt([], 2)).toBe(CHART_COLORS_HEX[2]);
  });

  test("wraps around once there are more series than palette colors", () => {
    const n = CHART_COLORS_HEX.length;
    expect(colorAt([], n)).toBe(CHART_COLORS_HEX[0]);
    expect(colorAt([], n + 3)).toBe(CHART_COLORS_HEX[3]);
  });
});

describe("isTextDatasets", () => {
  test("is true when every dataset with data holds text", () => {
    expect(isTextDatasets([dataset("text", 3)])).toBe(true);
  });

  test("is false for numeric or boolean data", () => {
    expect(isTextDatasets([dataset("number", 3)])).toBe(false);
    expect(isTextDatasets([dataset("boolean", 3)])).toBe(false);
  });

  test("is false when the types are mixed", () => {
    expect(isTextDatasets([dataset("text", 2), dataset("number", 2)])).toBe(false);
  });

  // Empty data carries no inferable type, so calling it text would wrongly lock the
  // heatmap for a property that simply has nothing in range yet.
  test("is false for empty datasets", () => {
    expect(isTextDatasets([dataset("text", 0)])).toBe(false);
    expect(isTextDatasets([])).toBe(false);
  });
});

describe("countValueFrequencies", () => {
  test("counts repeated scalars", () => {
    const counts = countValueFrequencies([point("a"), point("b"), point("a")]);
    expect(counts.get("a")).toBe(2);
    expect(counts.get("b")).toBe(1);
  });

  test("counts each element of a list property separately", () => {
    const counts = countValueFrequencies([point(["a", "b"]), point(["b"])]);
    expect(counts.get("a")).toBe(1);
    expect(counts.get("b")).toBe(2);
  });

  test("stringifies numbers and booleans", () => {
    const counts = countValueFrequencies([point(5), point(true)]);
    expect(counts.get("5")).toBe(1);
    expect(counts.get("true")).toBe(1);
  });

  test("ignores null and undefined", () => {
    const counts = countValueFrequencies([point(null), point(undefined), point(["a", null])]);
    expect(counts.size).toBe(1);
    expect(counts.get("a")).toBe(1);
  });

  // The regression this guards: counting in a plain object meant a note with
  // `tag: __proto__` read and wrote the object prototype instead of its own entry.
  test.each(["__proto__", "constructor", "toString", "hasOwnProperty"])(
    "counts %s as an ordinary value",
    (value) => {
      const counts = countValueFrequencies([point(value), point(value)]);
      expect(counts.get(value)).toBe(2);
      expect(counts.size).toBe(1);
    }
  );

  test("keeps a __proto__ value separate from other values", () => {
    const counts = countValueFrequencies([point("__proto__"), point("a")]);
    expect([...counts.keys()].sort()).toEqual(["__proto__", "a"]);
  });
});

describe("yearRange", () => {
  test("spans the whole year", () => {
    expect(yearRange(2026)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });
});

describe("isInFolder", () => {
  test("matches a file directly inside the folder", () => {
    expect(isInFolder("Daily/2026-01-01.md", "Daily")).toBe(true);
  });

  test("matches a file in a subfolder", () => {
    expect(isInFolder("Daily/Jan/01.md", "Daily")).toBe(true);
  });

  test("rejects a file outside the folder", () => {
    expect(isInFolder("Weekly/01.md", "Daily")).toBe(false);
  });

  // Without the separator, "Daily" would also match a sibling folder "DailyArchive".
  test("does not match a folder that merely shares a prefix", () => {
    expect(isInFolder("DailyArchive/01.md", "Daily")).toBe(false);
  });

  test("treats '/' and '' as the vault root, which contains everything", () => {
    expect(isInFolder("anywhere/note.md", "/")).toBe(true);
    expect(isInFolder("note.md", "")).toBe(true);
  });
});

describe("isDistributionType", () => {
  test.each(["pie", "doughnut", "polarArea"] as const)("accepts %s", (type) => {
    expect(isDistributionType(type)).toBe(true);
  });

  test.each(["line", "bar", "heatmap"] as const)("rejects %s", (type) => {
    expect(isDistributionType(type)).toBe(false);
  });
});
