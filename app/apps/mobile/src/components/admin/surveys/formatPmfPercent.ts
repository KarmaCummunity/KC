// KC#1058 — formats a 0..1 share for the PMF report. `null` (empty denominator) renders
// as a dash so a survey without answers never shows a misleading 0%.

export const NO_SHARE = '—';

/** 0.4 → "40%"; with `fractionDigits` 1, 0.0961 → "9.6%". */
export function formatPmfPercent(share: number | null, fractionDigits = 0): string {
  if (share === null || !Number.isFinite(share)) return NO_SHARE;
  const clamped = Math.min(Math.max(share, 0), 1);
  return `${(clamped * 100).toFixed(fractionDigits)}%`;
}
