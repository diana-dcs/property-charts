import { CSS } from "./types";
import { handle } from "./eventHandlers";

/**
 * The strip above a chart reporting how the file limit was applied, with a button to
 * flip to the other state.
 *
 * "truncated" warns that the limit cut the data short; "overridden" confirms that the
 * limit is currently off. They share one layout and differ only in wording and color.
 */
export type LimitState = "truncated" | "overridden";

export function renderLimitBanner(
  container: HTMLElement,
  state: LimitState,
  totalCount: number,
  limit: number,
  onToggle: () => Promise<void>,
): void {
  const truncated = state === "truncated";

  container.addClass(CSS.limit);
  container.addClass(truncated ? CSS.limitWarn : CSS.limitOk);

  container.createSpan({
    text: truncated
      ? `${limit.toLocaleString()} of ${totalCount.toLocaleString()} files loaded.`
      : `All ${totalCount.toLocaleString()} files loaded.`,
  });

  const btn = container.createEl("button", {
    text: truncated ? "Load all" : "Apply limit",
  });
  btn.onclick = handle(onToggle);
}
