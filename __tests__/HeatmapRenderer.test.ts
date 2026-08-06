/**
 * Tests for HeatmapRenderer
 *
 * Covers:
 * - computeHeatmapDimensions: pure layout calculation
 * - HEATMAP_WRAPPER_W: expected constant value
 * - renderHeatmap: chart construction and grid correctness
 * - renderHeatmapLegend: legend creation without throwing
 */

import { computeHeatmapDimensions, HEATMAP_WRAPPER_W, renderHeatmap, renderHeatmapLegend } from "../src/HeatmapRenderer";
import type { HeatmapPoint } from "../src/HeatmapRenderer";
import { Chart } from "chart.js/auto";

// ── DOM stub ────────────────────────────────────────────────────────────────

function makeElement(tag = "div"): HTMLElement {
  const el = {
    tagName: tag.toUpperCase(),
    style: { cssText: "", backgroundColor: "" } as any,
    children: [] as HTMLElement[],
    createEl: jest.fn((t: string) => makeElement(t)),
    createDiv: jest.fn(() => makeElement("div")),
    setText: jest.fn(),
    getPropertyValue: jest.fn(() => "#d0d0d0"),
  } as unknown as HTMLElement;
  return el;
}

// Minimal global document stub required by renderHeatmap / renderHeatmapLegend
const bodyStyle = {
  getPropertyValue: (_: string) => "#d0d0d0",
};
const docStub = {
  body: {
    style: bodyStyle,
  },
};
beforeAll(() => {
  (global as any).document = docStub;
  (global as any).getComputedStyle = (_el: unknown) => bodyStyle;
});
afterAll(() => {
  delete (global as any).document;
  delete (global as any).getComputedStyle;
});

// ── computeHeatmapDimensions ────────────────────────────────────────────────

describe("computeHeatmapDimensions", () => {
  it("returns pitch ≥ (CELL + GAP) for any width", () => {
    const { pitch } = computeHeatmapDimensions(100);
    expect(pitch).toBeGreaterThanOrEqual(13); // CELL(11) + GAP(2)
  });

  it("wrapperH = 7 × pitch + X_AXIS_H (24)", () => {
    const { pitch, wrapperH } = computeHeatmapDimensions(HEATMAP_WRAPPER_W);
    expect(wrapperH).toBe(7 * pitch + 24);
  });

  it("totalH = wrapperH + LEGEND_H (22)", () => {
    const { wrapperH, totalH } = computeHeatmapDimensions(HEATMAP_WRAPPER_W);
    expect(totalH).toBe(wrapperH + 22);
  });

  it("HEATMAP_WRAPPER_W yields default pitch = CELL + GAP (13)", () => {
    const { pitch } = computeHeatmapDimensions(HEATMAP_WRAPPER_W);
    expect(pitch).toBe(13);
  });

  it("wider container gives larger pitch", () => {
    const narrow = computeHeatmapDimensions(400);
    const wide = computeHeatmapDimensions(1200);
    expect(wide.pitch).toBeGreaterThan(narrow.pitch);
  });
});

// ── HEATMAP_WRAPPER_W constant ──────────────────────────────────────────────

describe("HEATMAP_WRAPPER_W", () => {
  it("equals 53 weeks × 13px pitch + 36px y-axis = 725", () => {
    // NUM_WEEKS(53) × PITCH(13) + Y_AXIS_W(36)
    expect(HEATMAP_WRAPPER_W).toBe(53 * 13 + 36);
  });
});

// ── renderHeatmap ───────────────────────────────────────────────────────────

describe("renderHeatmap", () => {
  it("returns a Chart instance", () => {
    const canvas = makeElement("canvas") as unknown as HTMLCanvasElement;
    const data: HeatmapPoint[] = [
      { date: "2024-06-01", value: 5 },
      { date: "2024-06-02", value: 3 },
    ];
    const result = renderHeatmap(canvas, data, "#6384FF", 2024, { preset: "all" }, false);
    expect(result).toBeInstanceOf(Chart);
  });

  it("does not throw for an empty data array", () => {
    const canvas = makeElement("canvas") as unknown as HTMLCanvasElement;
    expect(() =>
      renderHeatmap(canvas, [], "#6384FF", 2024, { preset: "all" }, false)
    ).not.toThrow();
  });

  it("does not throw for boolean property data", () => {
    const canvas = makeElement("canvas") as unknown as HTMLCanvasElement;
    const data: HeatmapPoint[] = [
      { date: "2024-03-15", value: true },
      { date: "2024-03-16", value: false },
    ];
    expect(() =>
      renderHeatmap(canvas, data, "#4BC0C0", 2024, { preset: "all" }, true)
    ).not.toThrow();
  });

  it("does not throw with a date range filter applied", () => {
    const canvas = makeElement("canvas") as unknown as HTMLCanvasElement;
    const data: HeatmapPoint[] = [
      { date: "2024-01-15", value: 2 },
      { date: "2024-06-01", value: 8 },
    ];
    expect(() =>
      renderHeatmap(canvas, data, "#FF6384", 2024, { from: "2024-01-01", to: "2024-03-31" }, false)
    ).not.toThrow();
  });
});

// ── renderHeatmapLegend ─────────────────────────────────────────────────────

describe("renderHeatmapLegend", () => {
  it("does not throw for a numeric property", () => {
    const container = makeElement("div");
    expect(() => renderHeatmapLegend(container, "#6384FF", false)).not.toThrow();
  });

  it("does not throw for a boolean property", () => {
    const container = makeElement("div");
    expect(() => renderHeatmapLegend(container, "#4BC0C0", true)).not.toThrow();
  });
});
