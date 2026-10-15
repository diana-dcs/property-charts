import { moment as obsidianMoment } from "obsidian";

/** The moment surface this plugin actually uses. */
export interface MomentLike {
  format(format?: string): string;
  isValid(): boolean;
  toDate(): Date;
  year(): number;
  clone(): MomentLike;
  add(amount: number, unit: "days"): MomentLike;
  subtract(amount: number, unit: "days"): MomentLike;
  startOf(unit: "isoWeek"): MomentLike;
  diff(other: MomentLike, unit: "days"): number;
}

type MomentFactory = (
  input?: Date | string | number | null,
  format?: string | string[],
  strict?: boolean,
) => MomentLike;

/**
 * Obsidian types its `moment` export as `typeof Moment`, taken from the `moment`
 * package's declarations. Where those declarations do not resolve — as in the plugin
 * review's environment — the export degrades to `any` and every call site becomes an
 * `no-unsafe-*` lint warning. This module pins the surface locally instead; at runtime
 * it is still Obsidian's own moment, nothing extra is loaded or bundled.
 */
export const moment = obsidianMoment as unknown as MomentFactory;
