// Shekel ↔ agorot for the money screens. The server keeps every amount in integer agorot; the
// copy shows shekels after its own "₪" sign, and the amount field takes shekels as typed.

/** Shekels as the copy shows them: whole amounts without decimals, others with two. */
export function shekelsText(agorot: number): string {
  const shekels = agorot / 100;
  return Number.isInteger(shekels) ? String(shekels) : shekels.toFixed(2);
}

/** Integer agorot of an amount typed in shekels. */
export function toAgorot(shekels: number): number {
  return Math.round(shekels * 100);
}
