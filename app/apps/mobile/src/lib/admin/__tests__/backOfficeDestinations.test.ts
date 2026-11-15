// Mapped to spec: FR-ADMIN-018, FR-ADMIN-032, FR-ADMIN-033 — the back-office tools are reachable
// from the admin navigation, each behind its own permission.
import { describe, expect, it } from 'vitest';
import { ADMIN_DESTINATIONS } from '../adminDestinations';
import { visibleDestinations } from '../adminSearch';

const keys = (roles: Parameters<typeof visibleDestinations>[1]) =>
  visibleDestinations(ADMIN_DESTINATIONS, roles).map((d) => d.key);

describe('back-office destinations', () => {
  it('staff see tasks and hours; moderators also see the CRM', () => {
    expect(keys(['support'])).toEqual(expect.arrayContaining(['tasks', 'time']));
    expect(keys(['support'])).not.toContain('crm');
    expect(keys(['moderator'])).toEqual(expect.arrayContaining(['tasks', 'time', 'crm']));
  });

  it('an organization admin or manager reaches the CRM of their organization only', () => {
    for (const role of ['org_admin', 'org_manager'] as const) {
      expect(keys([role])).toContain('crm');
      expect(keys([role])).not.toContain('tasks');
    }
    expect(keys(['org_employee'])).not.toContain('crm');
  });
});
