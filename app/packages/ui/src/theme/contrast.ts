// ─────────────────────────────────────────────
// WCAG contrast — used by the brand contrast floor (spec 17 §5)
// ─────────────────────────────────────────────

const HEX_COLOR = /^#([0-9a-f]{6})$/i;

function channelToLinear(channel: number): number {
  const srgb = channel / 255;
  return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x relative luminance of an opaque `#RRGGBB` colour. */
export function relativeLuminance(hex: string): number {
  const match = HEX_COLOR.exec(hex);
  if (!match) {
    throw new RangeError(`Expected an opaque #RRGGBB colour, got "${hex}"`);
  }
  const value = match[1];
  const [r, g, b] = [0, 2, 4].map((offset) => channelToLinear(Number.parseInt(value.slice(offset, offset + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio between two opaque colours, from 1 to 21. */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
