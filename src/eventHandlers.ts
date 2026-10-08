import { Notice } from "obsidian";
import { errorMessage } from "./types";

/**
 * Wraps a DOM event handler so a failure surfaces instead of vanishing.
 *
 * Most of the sidebar's handlers are async, and assigning one to `onclick` discards the
 * promise it returns: a rejection inside refresh() would become an unhandled rejection
 * that the user never sees. This funnels every handler through one report.
 */
export function handle(action: () => unknown): () => void {
  return () => {
    try {
      const result = action();
      if (result instanceof Promise) result.catch(reportHandlerError);
    } catch (e) {
      reportHandlerError(e);
    }
  };
}

function reportHandlerError(e: unknown): void {
  console.error("Property Charts: action failed", e);
  new Notice(`Property Charts: ${errorMessage(e)}`);
}
