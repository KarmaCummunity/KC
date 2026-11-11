// Pure helpers for the feed settings screen (mute filters over `feed_mute_filters`, quiet hours over 0256).

/** What a mute hides; `feed_mute_filters` holds exactly these three kinds. */
export type MuteKind = 'user' | 'keyword' | 'world';

export interface MuteFilter {
  filterId: string;
  filterKind: MuteKind;
  filterValue: string;
}

export interface GroupedMuteFilters {
  users: MuteFilter[];
  keywords: MuteFilter[];
  worlds: MuteFilter[];
}

/** Table limit: 2..60 chars after trim (single letters would hide half the feed). */
export const MUTE_KEYWORD_MIN = 2;
export const MUTE_KEYWORD_MAX = 60;

/** Trims, collapses inner whitespace and validates a keyword; null when it can't be saved. */
export function normalizeMuteKeyword(raw: string): string | null {
  const v = raw.replace(/\s+/g, ' ').trim();
  if (v.length < MUTE_KEYWORD_MIN || v.length > MUTE_KEYWORD_MAX) return null;
  return v;
}

/** Splits filters into users, keywords and giving worlds. */
export function groupMuteFilters(rows: readonly MuteFilter[]): GroupedMuteFilters {
  const out: GroupedMuteFilters = { users: [], keywords: [], worlds: [] };
  for (const r of rows) {
    if (r.filterKind === 'user') out.users.push(r);
    else if (r.filterKind === 'keyword') out.keywords.push(r);
    else out.worlds.push(r);
  }
  out.keywords.sort((a, b) => a.filterValue.localeCompare(b.filterValue));
  return out;
}

/** True when a keyword (case-insensitive) is already muted. */
export function isKeywordMuted(rows: readonly MuteFilter[], keyword: string): boolean {
  const k = keyword.toLocaleLowerCase();
  return rows.some((r) => r.filterKind === 'keyword' && r.filterValue.toLocaleLowerCase() === k);
}

/** The giving-world mute filter for a slug, if any. */
export function findWorldMute(rows: readonly MuteFilter[], worldSlug: string): MuteFilter | undefined {
  return rows.find((r) => r.filterKind === 'world' && r.filterValue === worldSlug);
}

/** Active mute rows (keywords, worlds, people) — each hides part of the signed-in feed. */
export function countMuteFilters(rows: readonly MuteFilter[]): number {
  return rows.length;
}

/** Quiet hours times are stored as 24h HH:MM (0256 casts them to time). */
export function isValidQuietTime(v: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

/** Accepts loose input ("7", "7:5", "0730") and returns HH:MM, or null if it isn't a time. */
export function normalizeQuietTime(raw: string): string | null {
  const s = raw.trim();
  let h: number;
  let m: number;
  const colon = /^(\d{1,2}):(\d{1,2})$/.exec(s);
  const digits = /^(\d{1,4})$/.exec(s);
  if (colon) {
    h = Number(colon[1]);
    m = Number(colon[2]);
  } else if (digits) {
    const d = digits[1]!;
    if (d.length <= 2) {
      h = Number(d);
      m = 0;
    } else {
      h = Number(d.slice(0, d.length - 2));
      m = Number(d.slice(-2));
    }
  } else {
    return null;
  }
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
