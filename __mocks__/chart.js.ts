// Minimal Chart.js mock for unit tests
export class Chart {
  /** The config of the most recently constructed chart, so tests can assert on it. */
  static lastConfig: unknown = null;

  static register(..._args: unknown[]) {}
  constructor(_canvas: unknown, config: unknown) {
    Chart.lastConfig = config;
  }
  destroy() {}
  update() {}
}
export default Chart;
