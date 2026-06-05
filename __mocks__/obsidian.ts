// Minimal Obsidian API mock for unit tests

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
