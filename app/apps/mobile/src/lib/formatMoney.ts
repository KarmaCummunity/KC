// Formats minor units (agorot/cents) as a localized currency string.
// Whole amounts drop the decimals ("₪1,200"); fractional ones keep two ("₪1,200.50").

export function formatMoney(cents: number, currency = 'ILS', locale = 'he-IL'): string {
  const major = cents / 100;
  const digits = Number.isInteger(major) ? 0 : 2;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(major);
  } catch {
    // An unknown currency code makes Intl throw; show the raw amount instead of crashing the screen.
    return `${major.toFixed(2)} ${currency}`;
  }
}
