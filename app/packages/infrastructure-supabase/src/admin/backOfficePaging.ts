// Keyset paging of the back-office lists (admin tasks, CRM contacts, timesheets).
//
// Each list RPC returns rows of `(<record> jsonb, cursor jsonb)`: the record, and the position
// that continues after it. The application sees the cursor as an opaque string; it is the JSON
// text of the server's position, sent back unchanged for the next page.
import type { Json } from '../database.types';

/** The server position to continue from, or null for the first page. */
export function decodeCursor(cursor: string | undefined): Json | null {
  if (!cursor) return null;
  return JSON.parse(cursor) as Json;
}

/**
 * The records of a page and the cursor of the next one. A page shorter than the limit is the
 * last; a full page may be followed by an empty one.
 */
export function readPage<R extends { readonly cursor: Json }, T>(
  rows: readonly R[] | null,
  limit: number,
  mapRow: (row: R) => T | null,
): { readonly rows: T[]; readonly nextCursor: string | null } {
  const list = rows ?? [];
  const mapped: T[] = [];
  for (const row of list) {
    const value = mapRow(row);
    if (value !== null) mapped.push(value);
  }
  const last = list[list.length - 1];
  return { rows: mapped, nextCursor: list.length >= limit && last ? JSON.stringify(last.cursor) : null };
}

/** A JSON object as a plain record, or null for any other JSON value. */
export function asRecord(value: Json | undefined): Record<string, Json | undefined> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/** A string field, or null. */
export function str(record: Record<string, Json | undefined>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

/** A timestamp field as a Date, or null. */
export function date(record: Record<string, Json | undefined>, key: string): Date | null {
  const value = str(record, key);
  return value === null ? null : new Date(value);
}

/** A string-array field; anything else is an empty list. */
export function strings(record: Record<string, Json | undefined>, key: string): string[] {
  const value = record[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
