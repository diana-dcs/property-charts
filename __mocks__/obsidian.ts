// Minimal Obsidian API mock for unit tests

export { default as moment } from "moment";

export class TFile {
  path: string;
  basename: string;
  extension: string;
  constructor(path: string) {
    this.path = path;
    this.extension = path.split(".").pop() ?? "";
    this.basename = path.split("/").pop()?.replace(/\.[^/.]+$/, "") ?? "";
  }
}

export class TFolder {
  path: string;
  children: (TFile | TFolder)[];
  constructor(path: string, children: (TFile | TFolder)[] = []) {
    this.path = path;
    this.children = children;
  }
}

export class Component {
  register(_cb: () => unknown): void {}
  registerEvent(_ref: unknown): void {}
}
export class MarkdownRenderChild extends Component {
  containerEl: HTMLElement;
  constructor(containerEl: HTMLElement) {
    super();
    this.containerEl = containerEl;
  }
}

/**
 * Stand-in for Obsidian's parseYaml. Deliberately not a YAML parser — tests that drive
 * process() set the parsed result directly with mockReturnValue, so they exercise our
 * own validation rather than a half-faithful parser.
 */
export const parseYaml = jest.fn((_source: string): unknown => {
  throw new Error("parseYaml mock has no configured return value");
});

export function normalizePath(path: string): string {
  return path
    .replace(/[\\/]+/g, "/")
    .replace(/^\/|\/$/g, "")
    .replace(/\u00A0/g, " ")
    .normalize();
}

export class Plugin {}
export class ItemView {}
export class WorkspaceLeaf {}

export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number,
  _immediate?: boolean
): T {
  return fn;
}
