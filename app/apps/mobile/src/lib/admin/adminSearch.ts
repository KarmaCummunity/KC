// app/apps/mobile/src/lib/admin/adminSearch.ts
// FR-ADMIN-011 / #2081 — pure search over the admin portal's destinations. Matches the screen's
// title in Hebrew AND English (whatever the UI language) plus its keyword list, so an admin can
// type either language. RBAC is applied first: a destination the session cannot open is never a result.
import { hasPermission, type AdminRole } from '@kc/domain';
import type { AdminDestination } from './adminDestinations';

/** One language's screen titles (`admin.nav`) and extra search words (`admin.searchKeywords`). */
export interface AdminSearchLanguage {
  readonly nav: Readonly<Record<string, string>>;
  readonly searchKeywords: Readonly<Record<string, string>>;
}

export interface AdminSearchLabels {
  readonly he: AdminSearchLanguage;
  readonly en: AdminSearchLanguage;
}

const norm = (s: string): string => s.trim().toLocaleLowerCase();

/** Destinations the roles may open (the search never reveals an unreachable screen). */
export function visibleDestinations(
  all: readonly AdminDestination[],
  roles: readonly AdminRole[],
): readonly AdminDestination[] {
  return all.filter((d) => d.available !== false && (d.perm == null || hasPermission(roles, d.perm)));
}

/**
 * Destinations matching `query`, best first: a title that starts with it, then a title that
 * contains it, then a keyword hit. Every whitespace-separated word must match somewhere.
 * An empty query returns nothing (the caller shows the regular dashboard).
 */
export function searchAdminDestinations(
  query: string,
  destinations: readonly AdminDestination[],
  labels: AdminSearchLabels,
): readonly AdminDestination[] {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const scored: { d: AdminDestination; rank: number }[] = [];
  for (const d of destinations) {
    const titles = [labels.he.nav[d.key], labels.en.nav[d.key]].filter((x): x is string => !!x).map(norm);
    const keywords = `${labels.he.searchKeywords[d.key] ?? ''} ${labels.en.searchKeywords[d.key] ?? ''}`
      .split(/\s+/)
      .filter(Boolean)
      .map(norm);
    let rank = 0;
    let all = true;
    for (const w of words) {
      if (titles.some((t) => t.startsWith(w))) rank += 0;
      else if (titles.some((t) => t.includes(w))) rank += 1;
      else if (keywords.some((k) => k.includes(w))) rank += 2;
      else {
        all = false;
        break;
      }
    }
    if (all) scored.push({ d, rank });
  }
  // Array.prototype.sort is stable, so equal ranks keep the navigation order.
  return scored.sort((a, b) => a.rank - b.rank).map((x) => x.d);
}
