// Mapped to spec: FR-ADMIN-011 — admin portal search (#2081): Hebrew + English, RBAC-filtered, ranked.
import { describe, expect, it } from 'vitest';
import { ADMIN_DESTINATIONS } from '../adminDestinations';
import { searchAdminDestinations, visibleDestinations } from '../adminSearch';
import { bothLocaleBundles } from '../../../i18n/useLocaleBundle';

const { he, en } = bothLocaleBundles();
const labels = { he: he.admin, en: en.admin };
const keys = (q: string, dest = ADMIN_DESTINATIONS) => searchAdminDestinations(q, dest, labels).map((d) => d.key);

describe('searchAdminDestinations', () => {
  it('finds a screen by its Hebrew title', () => {
    expect(keys('דיווחים')).toEqual(['reports']);
  });

  it('finds the same screen by an English keyword, whatever the UI language', () => {
    expect(keys('report')).toContain('reports');
    expect(keys('whatsapp')).toContain('whatsapp');
  });

  it('finds a screen by a word it manages that is not in the title', () => {
    expect(keys('חסימה')).toContain('users');
    expect(keys('kpi')).toContain('stats');
  });

  it('ranks a title that starts with the query before one that only contains it', () => {
    // "צוות ניהול" starts with it; "משימות צוות" merely contains it.
    const result = keys('צוות');
    expect(result.indexOf('admins')).toBeGreaterThanOrEqual(0);
    expect(result.indexOf('admins')).toBeLessThan(result.indexOf('tasks'));
  });

  it('requires every word to match, and ignores case and surrounding spaces', () => {
    expect(keys('  USERS ')).toContain('users');
    expect(keys('users zzzz')).toEqual([]);
  });

  it('returns nothing for an empty query and for no match (empty state)', () => {
    expect(keys('')).toEqual([]);
    expect(keys('   ')).toEqual([]);
    expect(keys('qqqqqq')).toEqual([]);
  });
});

describe('visibleDestinations (RBAC)', () => {
  it('hides destinations the roles lack the permission for, so search cannot surface them', () => {
    const none = visibleDestinations(ADMIN_DESTINATIONS, []);
    expect(none.every((d) => d.perm == null)).toBe(true);
    expect(keys('כספים', none)).toEqual([]);
    expect(keys('דיווחים', none)).toEqual(['reports']);
  });

  it('shows a permissioned destination to a role that holds it', () => {
    const all = visibleDestinations(ADMIN_DESTINATIONS, ['super_admin']);
    expect(all.map((d) => d.key)).toContain('money');
  });
});
