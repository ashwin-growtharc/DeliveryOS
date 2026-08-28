// Colour maths for the UI verification scripts: sRGB parsing, WCAG relative
// luminance, contrast ratio, and alpha compositing.
//
// Compositing matters here specifically. The stylesheet expressed "muted text"
// as an `opacity` on a full-strength ink colour rather than as its own colour,
// so the colour a user actually sees is the ink composited over whatever
// surface sits behind it. Judging those rules by their declared colour alone
// would report them all as passing; they only fail once composited. That is
// the whole reason 30 text rules were below WCAG AA without anyone noticing.

/** Parses `#rgb`, `#rrggbb` or `#rrggbbaa` into `{ r, g, b, a }` with channels
 *  0-255 and alpha 0-1. Returns undefined for anything else (a var(), a
 *  gradient, `transparent`, `inherit`) so callers can skip rather than guess. */
export function parseHex(value) {
  if (typeof value !== 'string') return undefined;
  const m = value.trim().match(/^#([0-9a-f]{3,8})$/i);
  if (!m) return undefined;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length === 6) h += 'ff';
  if (h.length !== 8) return undefined;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a: parseInt(h.slice(6, 8), 16) / 255,
  };
}

/** Parses the `rgb(...)`/`rgba(...)` form a browser's getComputedStyle
 *  returns, so this module can consume both authored CSS and computed values. */
export function parseRgb(value) {
  if (typeof value !== 'string') return undefined;
  const m = value.trim().match(/^rgba?\(([^)]+)\)$/i);
  if (!m) return undefined;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return undefined;
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
}

/** Parses either form. */
export function parseColor(value) {
  return parseHex(value) ?? parseRgb(value);
}

/** Composites `fg` (which may carry alpha, and may be further faded by
 *  `opacity`) over an opaque `bg`. This is the step that turns a declared
 *  colour into the colour a person actually sees. */
export function composite(fg, bg, opacity = 1) {
  const a = fg.a * opacity;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
}

/** WCAG 2.x relative luminance. */
export function luminance({ r, g, b }) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG contrast ratio, 1..21. Order-independent. */
export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Contrast of a foreground (optionally faded by `opacity`) against a
 *  background, rounded to 2dp — the number the reports print. */
export function effectiveContrast(fgValue, bgValue, opacity = 1) {
  const fg = parseColor(fgValue);
  const bg = parseColor(bgValue);
  if (!fg || !bg) return undefined;
  return Math.round(contrast(composite(fg, bg, opacity), bg) * 100) / 100;
}

/** WCAG AA floor for normal-size text. Large text (>=18.66px bold or >=24px)
 *  is allowed 3:1, but this app's muted text is all small, so the scripts
 *  hold everything to the stricter number rather than special-casing. */
export const AA_NORMAL = 4.5;

/** Formats a colour back to #rrggbb, for reporting a computed suggestion. */
export function toHex({ r, g, b }) {
  const h = (c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

/** Finds the colour closest to `target` (by linear interpolation toward
 *  `anchor`) that still clears `minRatio` against `bg`.
 *
 *  Used to pick real values for the new text tokens: the goal is the most
 *  muted colour that still passes, not an arbitrary darker one, so the visual
 *  hierarchy the opacity ramp was reaching for survives the conversion. */
export function mostMutedPassing(anchorValue, targetValue, bgValue, minRatio = AA_NORMAL) {
  const anchor = parseColor(anchorValue);
  const target = parseColor(targetValue);
  const bg = parseColor(bgValue);
  if (!anchor || !target || !bg) return undefined;
  // t=0 -> anchor (highest contrast), t=1 -> target (most muted).
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    const c = {
      r: anchor.r + (target.r - anchor.r) * mid,
      g: anchor.g + (target.g - anchor.g) * mid,
      b: anchor.b + (target.b - anchor.b) * mid,
      a: 1,
    };
    if (contrast(c, bg) >= minRatio) lo = mid;
    else hi = mid;
  }
  const best = {
    r: anchor.r + (target.r - anchor.r) * lo,
    g: anchor.g + (target.g - anchor.g) * lo,
    b: anchor.b + (target.b - anchor.b) * lo,
    a: 1,
  };
  return { hex: toHex(best), ratio: Math.round(contrast(best, bg) * 100) / 100 };
}
