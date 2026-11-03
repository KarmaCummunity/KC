// KC#1122 — formats a 0..1 match-quality rate for the admin dashboard.
// `null` means "no denominator yet" (or not tracked for the world) and renders as a dash,
// so an empty world is never shown as a misleading 0%.

export const NO_RATE = '—';

export function formatRate(rate: number | null): string {
  if (rate === null || !Number.isFinite(rate)) return NO_RATE;
  const clamped = Math.min(Math.max(rate, 0), 1);
  return `${Math.round(clamped * 100)}%`;
}
