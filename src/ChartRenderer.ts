import { Chart, ChartConfiguration, ChartDataset, ChartType as ChartJsType, Plugin } from "chart.js/auto";
import { moment } from "obsidian";

import {
  ChartConfig,
  ChartType,
  CSS,
  CSS_VARS,
  Dataset,
  DistributionType,
  isDistributionType,
  colorAt,
  numericValue,
  countValueFrequencies,
  stripWikiLinks,
} from "./types";
import { toRgba, themeColorString } from "./color";
import { renderHeatmap, renderHeatmapLegend, HEATMAP_WRAPPER_W, computeHeatmapDimensions } from "./HeatmapRenderer";

/**
 * Which Chart.js type draws each distribution type. Spelling the mapping out keeps the
 * `as ChartJsType` cast off `config.type`, which would silently accept "heatmap" — a
 * type Chart.js only knows once the matrix controller is registered.
 */
const DISTRIBUTION_CHARTJS_TYPE: Record<DistributionType, ChartJsType> = {
  pie: "pie",
  doughnut: "doughnut",
  polarArea: "polarArea",
};

/**
 * Chart.js type for the trend charts. Both the time-series and the frequency variant are
 * only ever reached for "line" and "bar"; anything else would be a caller bug, so it
 * falls back to the line chart rather than throwing mid-render.
 */
function trendChartJsType(type: ChartType): ChartJsType {
  return type === "bar" ? "bar" : "line";
}

/**
 * Chart.js draws onto a canvas, so the stylesheet's prefers-reduced-motion rule cannot
 * reach its animations — the option has to be set here.
 */
function animationOption(): false | undefined {
  const reduced =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return reduced ? false : undefined;
}

export class ChartRenderer {
  private chart: Chart | null = null;
  private canvas: HTMLCanvasElement;
  private heatmapWrapper: HTMLElement | null = null;

  /** @param responsiveHeatmap When true the heatmap fills the container width (embed).
   *  When false a fixed 725 px canvas is used and the container scrolls (sidebar). */
  constructor(private container: HTMLElement, private responsiveHeatmap = false) {
    this.canvas = container.createEl("canvas");
  }

  updateAriaLabel(config: ChartConfig): void {
    const props = config.properties.filter(Boolean).join(", ");
    const label = `${config.type} chart of "${props || "—"}" in folder "${config.folder || "—"}"`;
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", label);
  }

  async render(config: ChartConfig, datasets: Dataset[]): Promise<void> {
    // A heatmap needs numeric or boolean values; the explanatory hint is shown by
    // ChartView, so there is nothing to draw here.
    const isTextOnly = datasets.every((d) => d.valueType === "text");

    if (config.type === "heatmap") {
      if (isTextOnly) return;
      await this.renderHeatmapChart(config, datasets);
      return;
    }
    if (isDistributionType(config.type)) {
      this.renderDistributionChart(config, datasets, config.type);
      return;
    }
    if (isTextOnly) {
      this.renderFrequencyChart(config, datasets);
    } else {
      this.renderTimeSeriesChart(config, datasets);
    }
  }

  private async renderHeatmapChart(config: ChartConfig, datasets: Dataset[]): Promise<void> {
    const dataset = datasets[0];
    if (!dataset) return;

    // The constructor always creates this.canvas, but the heatmap draws on its own canvas
    // inside the wrapper below. Hide the unused one so it doesn't take up layout space.
    this.canvas.hide();

    // Embed: fit to container width (no scroll). Sidebar: fixed width, scrolls horizontally.
    // Defer the width read to after layout so clientWidth is non-zero on first render.
    const availW = this.responsiveHeatmap
      ? await new Promise<number>((resolve) =>
          window.requestAnimationFrame(() =>
            resolve(this.container.clientWidth || HEATMAP_WRAPPER_W)
          )
        )
      : HEATMAP_WRAPPER_W;
    const { wrapperH, totalH } = computeHeatmapDimensions(availW);

    // The heatmap modifier class adds horizontal scrolling as a safety valve for very
    // narrow containers and removes the padding.
    this.container.addClass(CSS.heatmapContainer);
    this.container.setCssProps({ [CSS_VARS.containerHeight]: `${totalH}px` });

    const wrapper = this.container.createDiv({ cls: CSS.heatmapWrapper });
    wrapper.setCssProps({
      [CSS_VARS.heatmapWidth]: `${availW}px`,
      [CSS_VARS.heatmapHeight]: `${totalH}px`,
      [CSS_VARS.heatmapChartHeight]: `${wrapperH}px`,
    });
    this.heatmapWrapper = wrapper;

    const chartDiv = wrapper.createDiv({ cls: CSS.heatmapChart });
    const canvas = chartDiv.createEl("canvas");

    // Legend below the chart, still inside the wrapper so it scrolls together.
    const color = colorAt(config.colors, 0);
    renderHeatmapLegend(wrapper, color);

    const year = config.heatmapYear ?? new Date().getFullYear();
    const isBool = dataset.valueType === "boolean";
    const points = dataset.points
      .filter((p) => p.date !== null)
      .map((p) => ({
        date: moment(p.date).format("YYYY-MM-DD"),
        value: numericValue(p),
      }));
    this.chart = renderHeatmap(canvas, points, color, year, config.range, isBool);
  }

  private renderTimeSeriesChart(config: ChartConfig, datasets: Dataset[]): void {
    const labels = this.buildLabels(datasets);

    const chartDatasets: ChartDataset[] = datasets.map((dataset, i) => {
      const color = colorAt(config.colors, i);
      const fill = toRgba(color, 0.8);
      const border = toRgba(color, 1);

      const pointMap = new Map(dataset.points.map((p) => [p.label, p]));
      const data = labels.map((label) => {
        const point = pointMap.get(label);
        return point ? numericValue(point) : null;
      });

      const base: ChartDataset = {
        label: dataset.property,
        data,
        backgroundColor: fill,
        borderColor: border,
        borderWidth: 2,
        pointRadius: 4,
        spanGaps: true,
      };

      if (config.type === "line") {
        return { ...base, tension: 0.3, fill: false };
      }
      return base;
    });

    const cfg: ChartConfiguration = {
      type: trendChartJsType(config.type),
      data: { labels, datasets: chartDatasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: animationOption(),
        plugins: {
          legend: { display: datasets.length > 1 },
          tooltip: { mode: "index", intersect: false },
        },
        scales: {
          x: { ticks: { maxTicksLimit: 10, maxRotation: 45 } },
          y: { beginAtZero: true },
        },
      },
    };

    this.chart = new Chart(this.canvas, cfg);
  }

  private renderFrequencyChart(config: ChartConfig, datasets: Dataset[]): void {
    const freqMaps = datasets.map((dataset) => countValueFrequencies(dataset.points));

    const allValues = new Set<string>();
    for (const freq of freqMaps) {
      for (const value of freq.keys()) allValues.add(value);
    }
    const rawKeys = [...allValues].sort();
    const labels = rawKeys.map(stripWikiLinks);

    const chartDatasets: ChartDataset[] = datasets.map((dataset, i) => {
      const color = colorAt(config.colors, i);
      const freq = freqMaps[i];
      return {
        label: dataset.property,
        data: rawKeys.map((key) => freq?.get(key) ?? 0),
        backgroundColor: toRgba(color, 0.8),
        borderColor: toRgba(color, 1),
        borderWidth: 2,
      };
    });

    const cfg: ChartConfiguration = {
      type: trendChartJsType(config.type),
      data: { labels, datasets: chartDatasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: animationOption(),
        plugins: { legend: { display: datasets.length > 1 } },
        scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
      },
    };

    this.chart = new Chart(this.canvas, cfg);
  }

  private renderDistributionChart(
    config: ChartConfig,
    datasets: Dataset[],
    type: DistributionType,
  ): void {
    const dataset = datasets[0];
    if (!dataset) return;

    const freq = countValueFrequencies(dataset.points);

    const rawKeys = [...freq.keys()].sort();
    const labels = rawKeys.map(stripWikiLinks);
    const data = rawKeys.map((key) => freq.get(key) ?? 0);
    const total = data.reduce((sum, value) => sum + value, 0);

    const isPolarArea = type === "polarArea";
    const bgAlpha = isPolarArea ? 0.6 : 0.85;

    const bgColors = labels.map((_, i) => toRgba(colorAt(config.colors, i), bgAlpha));
    const borderColors = labels.map((_, i) =>
      toRgba(colorAt(config.colors, i), isPolarArea ? 0.5 : 1)
    );

    const chartDataset: ChartDataset = {
      label: dataset.property,
      data,
      backgroundColor: bgColors,
      borderColor: borderColors,
      borderWidth: isPolarArea ? 1 : 2,
    };

    const instancePlugins: Plugin[] = [];
    if (type === "doughnut") {
      instancePlugins.push({
        id: "doughnutCenter",
        afterDraw(chart: Chart) {
          const { ctx, chartArea } = chart;
          if (!chartArea) return;
          const cx = (chartArea.left + chartArea.right) / 2;
          const cy = (chartArea.top + chartArea.bottom) / 2;
          ctx.save();
          ctx.font = "bold 1.4em sans-serif";
          ctx.fillStyle = themeColorString("--text-normal", "#333");
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(total), cx, cy);
          ctx.restore();
        },
      });
    }

    // For polarArea: move legend to bottom (gives the circle more square space),
    // and adapt scale colors for dark-mode compatibility.
    const mutedColor = themeColorString("--text-muted", "rgba(160,160,160,0.9)");

    const polarAreaScales: NonNullable<ChartConfiguration["options"]>["scales"] = isPolarArea
      ? {
          r: {
            grid: { color: "rgba(128,128,128,0.25)" },
            ticks: {
              backdropColor: "rgba(0,0,0,0)",
              backdropPadding: 0,
              color: mutedColor,
            },
          },
        }
      : undefined;

    const cfg: ChartConfiguration = {
      type: DISTRIBUTION_CHARTJS_TYPE[type],
      data: { labels, datasets: [chartDataset] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: animationOption(),
        layout: isPolarArea ? { padding: 8 } : undefined,
        plugins: {
          legend: { display: true, position: isPolarArea ? "bottom" : "right" },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                // polarArea stores parsed value as {r: number}, pie/doughnut as a number.
                const raw = ctx.parsed as number | { r: number };
                const val = typeof raw === "object" && raw !== null ? raw.r : raw;
                const pct = total > 0 ? Math.round((val / total) * 100) : 0;
                return ` ${ctx.label}: ${val} (${pct}%)`;
              },
            },
          },
        },
        ...(polarAreaScales ? { scales: polarAreaScales } : {}),
      },
      plugins: instancePlugins,
    };

    this.chart = new Chart(this.canvas, cfg);
  }

  private buildLabels(datasets: Dataset[]): string[] {
    const seen = new Set<string>();
    const labels: string[] = [];
    for (const dataset of datasets) {
      for (const point of dataset.points) {
        if (!seen.has(point.label)) {
          seen.add(point.label);
          labels.push(point.label);
        }
      }
    }
    return labels;
  }

  destroy(): void {
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
    if (this.heatmapWrapper) {
      this.heatmapWrapper.remove();
      this.heatmapWrapper = null;
    }
    this.canvas.remove();
    this.container.removeClass(CSS.heatmapContainer);
    this.container.setCssProps({ [CSS_VARS.containerHeight]: "" });
  }
}
