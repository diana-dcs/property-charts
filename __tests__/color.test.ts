import { hexToRgb, lerpRgba, parseRgbFunction, resolveRgb, rgba, toRgba, themeRgb } from "../src/color";

describe("hexToRgb", () => {
  test("parses 6-digit hex", () => {
    expect(hexToRgb("#6384FF")).toEqual([99, 132, 255]);
  });

  test("parses 3-digit shorthand by doubling each digit", () => {
    expect(hexToRgb("#fff")).toEqual([255, 255, 255]);
    expect(hexToRgb("#08f")).toEqual([0, 136, 255]);
  });

  test("is case insensitive", () => {
    expect(hexToRgb("#abcdef")).toEqual(hexToRgb("#ABCDEF"));
  });

  test.each(["#12", "#gggggg", "123456", "rgb(1,2,3)", ""])("rejects %s", (value) => {
    expect(hexToRgb(value)).toBeNull();
  });

  test("rejects 8-digit hex with alpha, which it cannot represent", () => {
    expect(hexToRgb("#6384FFAA")).toBeNull();
  });
});

describe("parseRgbFunction", () => {
  test("parses rgb() and rgba()", () => {
    expect(parseRgbFunction("rgb(1,2,3)")).toEqual([1, 2, 3]);
    expect(parseRgbFunction("rgba(10, 20, 30, 0.5)")).toEqual([10, 20, 30]);
  });

  test("rejects a malformed value", () => {
    expect(parseRgbFunction("rgb(")).toBeNull();
  });
});

describe("resolveRgb", () => {
  test("trims surrounding whitespace", () => {
    expect(resolveRgb("  #fff  ")).toEqual([255, 255, 255]);
  });

  test("returns null for an unresolvable value when no canvas is available", () => {
    expect(resolveRgb("definitely-not-a-color")).toBeNull();
  });
});

describe("rgba / toRgba", () => {
  test("rgba formats a triple with its alpha", () => {
    expect(rgba([1, 2, 3], 0.5)).toBe("rgba(1, 2, 3, 0.5)");
  });

  // The regression this guards: ChartRenderer used to accept only 6-digit hex and
  // silently painted everything else in the default blue, while the heatmap resolved
  // rgb() and CSS names correctly. Both now go through resolveRgb.
  test("toRgba honours an rgb() value instead of falling back", () => {
    expect(toRgba("rgb(255,0,0)", 1)).toBe("rgba(255, 0, 0, 1)");
  });

  test("toRgba honours 3-digit hex instead of falling back", () => {
    expect(toRgba("#0f0", 0.8)).toBe("rgba(0, 255, 0, 0.8)");
  });

  test("toRgba falls back to the default palette color when nothing resolves", () => {
    expect(toRgba("not-a-color", 1)).toBe("rgba(99, 132, 255, 1)");
  });
});

describe("lerpRgba", () => {
  test("returns the endpoints at t=0 and t=1", () => {
    expect(lerpRgba([0, 0, 0], [100, 200, 50], 0, 1)).toBe("rgba(0, 0, 0, 1)");
    expect(lerpRgba([0, 0, 0], [100, 200, 50], 1, 1)).toBe("rgba(100, 200, 50, 1)");
  });

  test("rounds the midpoint", () => {
    expect(lerpRgba([0, 0, 0], [10, 11, 13], 0.5, 1)).toBe("rgba(5, 6, 7, 1)");
  });

  test("passes the alpha through", () => {
    expect(lerpRgba([0, 0, 0], [255, 255, 255], 0.5, 0.15)).toBe(
      "rgba(128, 128, 128, 0.15)"
    );
  });
});

describe("themeRgb", () => {
  const withTheme = (value: string, fn: () => void) => {
    (global as unknown as { document: unknown }).document = { body: {} };
    (global as unknown as { getComputedStyle: unknown }).getComputedStyle = () => ({
      getPropertyValue: () => value,
    });
    try {
      fn();
    } finally {
      delete (global as unknown as Record<string, unknown>).document;
      delete (global as unknown as Record<string, unknown>).getComputedStyle;
    }
  };

  test("resolves a theme variable", () => {
    withTheme("#d0d0d0", () => {
      expect(themeRgb("--background-modifier-border")).toEqual([208, 208, 208]);
    });
  });

  test("falls back when the variable is unset", () => {
    withTheme("", () => {
      expect(themeRgb("--background-modifier-border", [1, 2, 3])).toEqual([1, 2, 3]);
    });
  });
});
