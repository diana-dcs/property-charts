/**
 * Color resolution shared by every renderer.
 *
 * Chart colors reach us as untrusted strings from a code block or a color picker, and
 * `isValidColor` in types.ts accepts anything the browser can paint — hex, rgb()/hsl()
 * and CSS names alike. Each renderer therefore has to resolve the same range of inputs
 * to RGB, so that logic lives here once instead of per chart type.
 */

export type Rgb = readonly [number, number, number];

/** Used when a color cannot be resolved at all, so a series is never drawn invisible. */
export const FALLBACK_RGB: Rgb = [99, 132, 255];

/** Neutral gray for theme variables that are unset (e.g. in tests or a sparse theme). */
export const NEUTRAL_RGB: Rgb = [200, 200, 200];

export function hexToRgb(hex: string): Rgb | null {
  const short = hex.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (short) {
    return [
      parseInt(short[1] + short[1], 16),
      parseInt(short[2] + short[2], 16),
      parseInt(short[3] + short[3], 16),
    ];
  }
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

export function parseRgbFunction(css: string): Rgb | null {
  const rgb = css.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return rgb ? [parseInt(rgb[1]), parseInt(rgb[2]), parseInt(rgb[3])] : null;
}

/**
 * Resolves any CSS color (named colors included) to RGB by letting the canvas
 * normalize it. Renderers interpolate and alpha-blend between RGB triples, so a color
 * they cannot parse would silently render as the fallback.
 */
function cssColorToRgb(value: string): Rgb | null {
  // `typeof document` rather than `document?.`: the latter still throws a ReferenceError
  // when the identifier is not declared at all, as outside a browser.
  if (typeof document === "undefined" || typeof document.createElement !== "function") {
    return null;
  }
  try {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return null;
    // An unparseable value leaves fillStyle untouched, so an unlikely sentinel
    // doubles as the failure signal — and never collides with a real request.
    const sentinel = "#010203";
    ctx.fillStyle = sentinel;
    ctx.fillStyle = value;
    const normalized = ctx.fillStyle;
    if (typeof normalized !== "string" || normalized === sentinel) return null;
    return hexToRgb(normalized) ?? parseRgbFunction(normalized);
  } catch {
    return null;
  }
}

/** Resolves a user-supplied chart color, trying hex, rgb() and then the canvas. */
export function resolveRgb(value: string): Rgb | null {
  const trimmed = value.trim();
  return hexToRgb(trimmed) ?? parseRgbFunction(trimmed) ?? cssColorToRgb(trimmed);
}

/** Resolves a user-supplied chart color to an `rgba()` string, never failing. */
export function toRgba(value: string, alpha: number): string {
  return rgba(resolveRgb(value) ?? FALLBACK_RGB, alpha);
}

export function rgba([r, g, b]: Rgb, alpha: number): string {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Reads a theme CSS variable off document.body and resolves it to RGB. */
export function themeRgb(cssVar: string, fallback: Rgb = NEUTRAL_RGB): Rgb {
  const raw = getComputedStyle(document.body).getPropertyValue(cssVar).trim();
  if (raw === "") return fallback;
  return resolveRgb(raw) ?? fallback;
}

/** Reads a theme CSS variable as a raw CSS string, for values passed straight to canvas. */
export function themeColorString(cssVar: string, fallback: string): string {
  return getComputedStyle(document.body).getPropertyValue(cssVar).trim() || fallback;
}

export function lerpRgba(from: Rgb, to: Rgb, t: number, alpha: number): string {
  return rgba(
    [
      Math.round(from[0] + (to[0] - from[0]) * t),
      Math.round(from[1] + (to[1] - from[1]) * t),
      Math.round(from[2] + (to[2] - from[2]) * t),
    ],
    alpha,
  );
}
