import { Chart, ChartConfiguration, ChartDataset, ChartType as ChartJsType, Plugin } from "chart.js/auto";
import { moment } from "obsidian";

import {
  ChartConfig,
  ChartType,
  CHART_COLORS_HEX,
  CSS,
  CSS_VARS,
  DISTRIBUTION_TYPES,
  Dataset,
  stripWikiLinks,
} from "./types";
import { renderHeatmap, renderHeatmapLegend, HEATMAP_WRAPPER_W, computeHeatmapDimensions } from "./HeatmapRenderer";

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
    if (config.type === "heatmap") {
      const isTextOnly = datasets.every((d) => d.valueType === "text");
      if (isTextOnly) return; // hint shown in sidebar by ChartView
      await this.renderHeatmapChart(config, datasets);
      return;
    }
    if (DISTRIBUTION_TYPES.includes(config.type)) {
      this.renderDistributionChart(config, datasets);
      return;
    }
    const isTextOnly = datasets.every((d) => d.valueType === "text");
    if (isTextOnly) {
      this.renderFrequencyChart(config, datasets);
    } else {
      this.renderTimeSeriesChart(config, datasets);
    }
  }

  private async renderHeatmapChart(config: ChartConfig, datasets: Dataset[]): Promise<void> {
    const dataset = datasets[0];
    if (!dataset) return;

    // The constructor always creates this.canvas, which would fill the container via the
    // CSS rule "canvas { width:100%; height:100% }". Hide it so it doesn't obscure the
    // heatmap wrapper below.
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
    const color = this.resolveColor(config, 0);
    renderHeatmapLegend(wrapper, color, dataset.valueType === "boolean");

    const year = config.heatmapYear ?? new Date().getFullYear();
    const isBool = dataset.valueType === "boolean";
    const points = dataset.points
      .filter((p) => p.date !== null)
      .map((p) => ({
        date: moment(p.date!).format("YYYY-MM-DD"),
        value: p.value as number | boolean | null,
      }));
    this.chart = renderHeatmap(canvas, points, color, year, config.range, isBool);
  }

  private resolveColor(config: ChartConfig, i: number): string {
    return config.colors?.[i] ?? CHART_COLORS_HEX[i % CHART_COLORS_HEX.length];
  }

  private renderTimeSeriesChart(config: ChartConfig, datasets: Dataset[]): void {
    const labels = this.buildLabels(datasets);

    const chartDatasets: ChartDataset[] = datasets.map((dataset, i) => {
      const hex = this.resolveColor(config, i);
      const fill = this.hexToRgba(hex, 0.8);
      const border = this.hexToRgba(hex, 1);

      const pointMap = new Map(dataset.points.map((p) => [p.label, p]));
      const data = labels.map((label) => {
        const point = pointMap.get(label);
        return point ? (point.value as number) : null;
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
      type: this.mapChartType(config.type),
      data: { labels, datasets: chartDatasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
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
    const allLabels = new Set<string>();
    const freqMaps = datasets.map((dataset) => {
      const freq: Record<string, number> = {};
      for (const point of dataset.points) {
        const vals = Array.isArray(point.rawValue)
          ? (point.rawValue as unknown[]).map(String)
          : [String(point.rawValue)];
        for (const val of vals) {
          freq[val] = (freq[val] ?? 0) + 1;
          allLabels.add(val);
        }
      }
      return freq;
    });

    const rawKeys = Array.from(allLabels).sort();
    const labels = rawKeys.map(stripWikiLinks);

    const chartDatasets: ChartDataset[] = datasets.map((dataset, i) => {
      const hex = this.resolveColor(config, i);
      return {
        label: dataset.property,
        data: rawKeys.map((k) => freqMaps[i][k] ?? 0),
        backgroundColor: this.hexToRgba(hex, 0.8),
        borderColor: this.hexToRgba(hex, 1),
        borderWidth: 2,
      };
    });

    const cfg: ChartConfiguration = {
      type: config.type === "line" ? "line" : "bar",
      data: { labels, datasets: chartDatasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: datasets.length > 1 } },
        scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
      },
    };

    this.chart = new Chart(this.canvas, cfg);
  }

  private renderDistributionChart(config: ChartConfig, datasets: Dataset[]): void {
    const dataset = datasets[0];
    if (!dataset) return;

    const freq: Record<string, number> = {};
    for (const point of dataset.points) {
      if (point.rawValue === null || point.rawValue === undefined) continue;
      const vals = Array.isArray(point.rawValue)
        ? (point.rawValue as unknown[]).map(String)
        : [String(point.rawValue)];
      for (const val of vals) {
        freq[val] = (freq[val] ?? 0) + 1;
      }
    }

    const rawKeys = Object.keys(freq).sort();
    const labels = rawKeys.map(stripWikiLinks);
    const data = rawKeys.map((k) => freq[k]);
    const total = data.reduce((s, v) => s + v, 0);

    const isPolarArea = config.type === "polarArea";
    const bgAlpha = isPolarArea ? 0.6 : 0.85;

    const bgColors = labels.map((_, i) =>
      this.hexToRgba(config.colors?.[i] ?? CHART_COLORS_HEX[i % CHART_COLORS_HEX.length], bgAlpha)
    );
    const borderColors = labels.map((_, i) =>
      this.hexToRgba(config.colors?.[i] ?? CHART_COLORS_HEX[i % CHART_COLORS_HEX.length], isPolarArea ? 0.5 : 1)
    );

    const chartDataset: ChartDataset = {
      label: dataset.property,
      data,
      backgroundColor: bgColors,
      borderColor: borderColors,
      borderWidth: isPolarArea ? 1 : 2,
    };

    const instancePlugins: Plugin[] = [];
    if (config.type === "doughnut") {
      instancePlugins.push({
        id: "doughnutCenter",
        afterDraw(chart: Chart) {
          const { ctx, chartArea } = chart;
          if (!chartArea) return;
          const cx = (chartArea.left + chartArea.right) / 2;
          const cy = (chartArea.top + chartArea.bottom) / 2;
          ctx.save();
          ctx.font = "bold 1.4em sans-serif";
          ctx.fillStyle =
            getComputedStyle(document.body).getPropertyValue("--text-normal") || "#333";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(total), cx, cy);
          ctx.restore();
        },
      } as Plugin);
    }

    // For polarArea: move legend to bottom (gives the circle more square space),
    // and adapt scale colors for dark-mode compatibility.
    const mutedColor =
      getComputedStyle(document.body).getPropertyValue("--text-muted").trim() ||
      "rgba(160,160,160,0.9)";

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
      type: config.type as ChartJsType,
      data: { labels, datasets: [chartDataset] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
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

  private hexToRgba(hex: string, alpha: number): string {
    if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) hex = CHART_COLORS_HEX[0];
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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

  private mapChartType(type: ChartType): ChartJsType {
    return type === "bar" ? "bar" : "line";
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
