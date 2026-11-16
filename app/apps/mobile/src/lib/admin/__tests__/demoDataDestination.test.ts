// Mapped to spec: FR-ADMIN-031 AC6 — the Demo data screen is in the admin navigation and the
// dashboard search for the super admin and org admins (the server narrows org admins to the
// platform organization), and hidden from every other role.
import { describe, expect, it } from 'vitest';
import { bothLocaleBundles } from '../../../i18n/useLocaleBundle';
import { ADMIN_DESTINATIONS } from '../adminDestinations';
import { searchAdminDestinations, visibleDestinations } from '../adminSearch';

const keys = (roles: Parameters<typeof visibleDestinations>[1]) =>
  visibleDestinations(ADMIN_DESTINATIONS, roles).map((d) => d.key);

describe('demo data destination (FR-ADMIN-031)', () => {
  it('is shown to the super admin and org admins only', () => {
    expect(keys(['super_admin'])).toContain('demoData');
    expect(keys(['org_admin'])).toContain('demoData');
    for (const role of ['admin', 'moderator', 'support', 'org_manager', 'org_volunteer'] as const) {
      expect(keys([role])).not.toContain('demoData');
    }
  });

  it('opens the demo-data route', () => {
    expect(ADMIN_DESTINATIONS.find((d) => d.key === 'demoData')?.href).toBe('/(admin)/demo-data');
  });

  it('is found by the dashboard search in Hebrew and English', () => {
    const { he, en } = bothLocaleBundles();
    const labels = { he: he.admin, en: en.admin };
    const visible = visibleDestinations(ADMIN_DESTINATIONS, ['super_admin']);
    expect(searchAdminDestinations('דמה', visible, labels).map((d) => d.key)).toContain('demoData');
    expect(searchAdminDestinations('demo', visible, labels).map((d) => d.key)).toContain('demoData');
  });
});
