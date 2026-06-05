import { Chart, ChartConfiguration, ChartDataset, ChartType as ChartJsType } from "chart.js/auto";

import {
  ChartConfig,
  ChartType,
  CHART_COLORS_HEX,
  Dataset,
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

  async render(config: ChartConfig, datasets: Dataset[]): Promise<void> {
    if (config.type === "heatmap") {
      this.renderHeatmapChart(config, datasets);
      return;
    }
    const isTextOnly = datasets.every((d) => d.valueType === "text");
    if (isTextOnly) {
      this.renderFrequencyChart(config, datasets);
    } else {
      this.renderTimeSeriesChart(config, datasets);
    }
  }

  private renderHeatmapChart(config: ChartConfig, datasets: Dataset[]): void {
    const dataset = datasets[0];
    if (!dataset) return;

    // The constructor always creates this.canvas, which would fill the container via the
    // CSS rule "canvas { width:100%; height:100% }". Hide it so it doesn't obscure the
    // heatmap wrapper below.
    this.canvas.style.display = "none";

    // Embed: fit to container width (no scroll). Sidebar: fixed width, scrolls horizontally.
    const availW = this.responsiveHeatmap
      ? (this.container.clientWidth || HEATMAP_WRAPPER_W)
      : HEATMAP_WRAPPER_W;
    const { wrapperH, totalH } = computeHeatmapDimensions(availW);

    this.container.style.height = `${totalH}px`;
    this.container.style.overflowX = "auto"; // safety valve for very narrow containers
    this.container.style.padding = "0";

    const wrapper = this.container.createDiv({ cls: "chart-plugin-heatmap-wrapper" });
    wrapper.style.cssText = `width:${availW}px;height:${totalH}px;flex-shrink:0;`;
    this.heatmapWrapper = wrapper;

    const chartDiv = wrapper.createDiv();
    chartDiv.style.cssText = `width:${availW}px;height:${wrapperH}px;position:relative;`;
    const canvas = chartDiv.createEl("canvas");

    // Legend below the chart, still inside the wrapper so it scrolls together.
    const color = this.resolveColor(config, 0);
    renderHeatmapLegend(wrapper, color, dataset.valueType === "boolean");

    const year = config.heatmapYear ?? new Date().getFullYear();
    const isBool = dataset.valueType === "boolean";
    const points = dataset.points.map((p) => ({
      date: window.moment(p.date).format("YYYY-MM-DD"),
      value: p.value as number | boolean | null,
    }));
    this.chart = renderHeatmap(canvas, points, color, year, config.range, isBool);
  }

  private resolveColor(config: ChartConfig, i: number): string {
    return config.colors?.[i] ?? CHART_COLORS_HEX[i % CHART_COLORS_HEX.length];
  }

  private renderTimeSeriesChart(config: ChartConfig, datasets: Dataset[]): void {
    const labels = this.buildLabels(datasets, config.dateFormat);

    const chartDatasets: ChartDataset[] = datasets.map((dataset, i) => {
      const hex = this.resolveColor(config, i);
      const fill = this.hexToRgba(hex, 0.8);
      const border = this.hexToRgba(hex, 1);

      const data = labels.map((label) => {
        const point = dataset.points.find(
          (p) => this.formatDate(p.date, config.dateFormat) === label
        );
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
        const val = String(point.rawValue);
        freq[val] = (freq[val] ?? 0) + 1;
        allLabels.add(val);
      }
      return freq;
    });

    const labels = Array.from(allLabels).sort();

    const chartDatasets: ChartDataset[] = datasets.map((dataset, i) => {
      const hex = this.resolveColor(config, i);
      return {
        label: dataset.property,
        data: labels.map((l) => freqMaps[i][l] ?? 0),
        backgroundColor: this.hexToRgba(hex, 0.8),
        borderColor: this.hexToRgba(hex, 1),
        borderWidth: 2,
      };
    });

    const cfg: ChartConfiguration = {
      type: "bar",
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

  private hexToRgba(hex: string, alpha: number): string {
    if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) hex = CHART_COLORS_HEX[0];
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  private buildLabels(datasets: Dataset[], dateFormat: string): string[] {
    const dateSet = new Set<string>();
    for (const dataset of datasets) {
      for (const point of dataset.points) {
        dateSet.add(this.formatDate(point.date, dateFormat));
      }
    }
    return Array.from(dateSet).sort();
  }

  private formatDate(date: Date, format: string): string {
    return window.moment(date).format(format);
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
    if (this.container.style) {
      this.container.style.height = "";
      this.container.style.overflowX = "";
      this.container.style.overflowY = "";
      this.container.style.padding = "";
    }
  }
}
