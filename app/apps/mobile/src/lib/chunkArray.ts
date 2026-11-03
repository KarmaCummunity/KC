/** Split an array into fixed-size chunks (e.g. profile post grid rows). */
export function chunkArray<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) return [];
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    rows.push(items.slice(i, i + size));
  }
  return rows;
}
