/**
 * A stand-in for the HTMLElement that Obsidian extends with createDiv/createEl, addClass
 * and friends. Enough of it to build the sidebar controls in a node test and then click
 * them, which is how the config-ownership contract is checked.
 */
export interface FakeElement {
  tag: string;
  classes: Set<string>;
  attrs: Map<string, string>;
  children: FakeElement[];
  text: string;
  id: string;
  value: string;
  type: string;
  selected: boolean;
  disabled: boolean;
  visible: boolean;
  onclick: (() => void) | null;
  onchange: (() => void) | null;
  oninput: (() => void) | null;

  createDiv(opts?: ElOpts): FakeElement;
  createSpan(opts?: ElOpts): FakeElement;
  createEl(tag: string, opts?: ElOpts): FakeElement;
  addClass(cls: string): void;
  removeClass(cls: string): void;
  toggleClass(cls: string, on: boolean): void;
  hasClass(cls: string): boolean;
  setText(text: string): void;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  removeAttribute(name: string): void;
  setCssProps(props: Record<string, string>): void;
  querySelectorAll(selector: string): FakeElement[];
  empty(): void;
  hide(): void;
  show(): void;
  toggle(on: boolean): void;
  remove(): void;
}

interface ElOpts {
  cls?: string;
  text?: string;
  value?: string;
  type?: string;
}

export function fakeElement(tag = "div"): FakeElement {
  const el: FakeElement = {
    tag,
    classes: new Set<string>(),
    attrs: new Map<string, string>(),
    children: [],
    text: "",
    id: "",
    value: "",
    type: "",
    selected: false,
    disabled: false,
    visible: true,
    onclick: null,
    onchange: null,
    oninput: null,

    createDiv: (opts) => el.createEl("div", opts),
    createSpan: (opts) => el.createEl("span", opts),
    createEl(childTag, opts) {
      const child = fakeElement(childTag);
      if (opts?.cls) opts.cls.split(/\s+/).forEach((c) => child.classes.add(c));
      if (opts?.text !== undefined) child.text = opts.text;
      if (opts?.value !== undefined) child.value = opts.value;
      if (opts?.type !== undefined) child.type = opts.type;
      el.children.push(child);
      return child;
    },
    addClass: (cls) => void el.classes.add(cls),
    removeClass: (cls) => void el.classes.delete(cls),
    toggleClass(cls, on) {
      if (on) el.classes.add(cls);
      else el.classes.delete(cls);
    },
    hasClass: (cls) => el.classes.has(cls),
    setText(text) {
      el.text = text;
    },
    setAttribute: (name, value) => void el.attrs.set(name, value),
    getAttribute: (name) => el.attrs.get(name) ?? null,
    removeAttribute: (name) => void el.attrs.delete(name),
    setCssProps: () => undefined,
    querySelectorAll: (selector) => descendants(el).filter((d) => d.tag === selector),
    empty() {
      el.children = [];
    },
    hide() {
      el.visible = false;
    },
    show() {
      el.visible = true;
    },
    toggle(on) {
      el.visible = on;
    },
    remove: () => undefined,
  };
  return el;
}

export function descendants(el: FakeElement): FakeElement[] {
  return el.children.flatMap((child) => [child, ...descendants(child)]);
}

/** The first descendant whose rendered text matches, for locating a button to click. */
export function findByText(el: FakeElement, text: string): FakeElement {
  const match = descendants(el).find((d) => d.text === text);
  if (!match) {
    throw new Error(
      `No element with text "${text}". Found: ${descendants(el)
        .map((d) => d.text)
        .filter(Boolean)
        .join(" | ")}`
    );
  }
  return match;
}

export function findByTag(el: FakeElement, tag: string): FakeElement[] {
  return descendants(el).filter((d) => d.tag === tag);
}
