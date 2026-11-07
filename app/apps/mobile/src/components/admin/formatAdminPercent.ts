// KC#1801 — formats a 0..1 rate or share for admin dashboards (match quality KC#1122,
// PMF report KC#1058). `null` means "no denominator yet" and renders as a dash, so an
// empty world or a survey without answers never shows a misleading 0%.

export const NO_PERCENT = '—';

/** 0.4 → "40%"; with `fractionDigits` 1, 0.0961 → "9.6%". Values outside 0..1 are clamped. */
export function formatAdminPercent(rate: number | null, fractionDigits = 0): string {
  if (rate === null || !Number.isFinite(rate)) return NO_PERCENT;
  const clamped = Math.min(Math.max(rate, 0), 1);
  return `${(clamped * 100).toFixed(fractionDigits)}%`;
}
