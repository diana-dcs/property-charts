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

export class Notice {
  constructor(public message: string) {}
}

export class Plugin {}
export class ItemView {}
export class WorkspaceLeaf {}

/**
 * Models Obsidian's debounce rather than running synchronously, because the coalescing
 * is what the refresh-scope tests are about.
 *
 * Note the third parameter is `resetTimer` — every call pushes the trailing call further
 * out — and *not* `immediate`: it never fires on the leading edge. It also invokes the
 * callback with the arguments of the last call, which is the behaviour that made passing
 * a refresh scope as an argument unsafe.
 */
export function debounce<T extends unknown[]>(
  fn: (...args: T) => unknown,
  timeout = 0,
  resetTimer = false
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: T;

  const debounced = (...args: T) => {
    lastArgs = args;
    if (resetTimer && timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (timer === null) {
      timer = setTimeout(() => {
        timer = null;
        fn(...lastArgs);
      }, timeout);
    }
    return debounced;
  };

  debounced.cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    return debounced;
  };

  debounced.run = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
      fn(...lastArgs);
    }
    return debounced;
  };

  return debounced;
}
