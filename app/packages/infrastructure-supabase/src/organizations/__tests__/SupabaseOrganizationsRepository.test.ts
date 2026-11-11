import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { OrgError } from '@kc/domain';
import { SupabaseOrganizationsRepository, toOrgError } from '../SupabaseOrganizationsRepository';

type Result = { data: unknown; error: unknown };

function makeRepo(rpc: Record<string, Result>, table: Result = { data: [], error: null }) {
  const calls: Array<{ fn: string; args: unknown }> = [];
  // A chainable query builder that resolves to `table` at the end of any chain.
  const builder: Record<string, unknown> = {};
  for (const step of ['select', 'eq', 'order', 'limit']) builder[step] = () => builder;
  builder.maybeSingle = async () => table;
  builder.then = (resolve: (r: Result) => unknown) => resolve(table);
  const client = {
    rpc: async (fn: string, args: unknown) => {
      calls.push({ fn, args });
      return rpc[fn] ?? { data: null, error: null };
    },
    from: () => builder,
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
  } as unknown as SupabaseClient;
  return { repo: new SupabaseOrganizationsRepository(client as never), calls };
}

describe('toOrgError', () => {
  it('keeps a server code and maps anything else to unknown', () => {
    expect(toOrgError({ message: 'org_last_admin' }).code).toBe('org_last_admin');
    expect(toOrgError({ message: 'boom' })).toMatchObject({ code: 'unknown' });
  });
});

describe('SupabaseOrganizationsRepository', () => {
  it('submits an application with null optionals left out', async () => {
    const { repo, calls } = makeRepo({ submit_org_application: { data: 'app-1', error: null } });
    await expect(repo.submitApplication({
      orgName: 'Org', orgDescription: 'About', contactEmail: 'a@b.org',
      contactPhone: null, websiteUrl: null, declaredNonprofit: true,
    })).resolves.toBe('app-1');
    expect(calls[0]).toEqual({
      fn: 'submit_org_application',
      args: {
        p_org_name: 'Org', p_org_description: 'About', p_contact_email: 'a@b.org',
        p_contact_phone: undefined, p_website_url: undefined, p_declared_nonprofit: true,
      },
    });
  });

  it('throws the server code as OrgError', async () => {
    const { repo } = makeRepo({ org_add_member: { data: null, error: { message: 'org_member_manage_forbidden' } } });
    await expect(repo.addMember('o1', 'dana', 'org_admin')).rejects.toBeInstanceOf(OrgError);
    await expect(repo.addMember('o1', 'dana', 'org_admin')).rejects.toMatchObject({ code: 'org_member_manage_forbidden' });
  });

  it('lists members strongest role first and skips unknown roles', async () => {
    const row = (user_id: string, role: string, display_name: string) => ({
      user_id, role, display_name, share_handle: user_id, avatar_url: null, joined_at: '2026-11-10T00:00:00Z',
    });
    const { repo } = makeRepo({
      list_org_members: { data: [row('u2', 'org_volunteer', 'Bet'), row('u1', 'org_admin', 'Alef'), row('u3', 'volunteer', 'Gimel')], error: null },
    });
    const members = await repo.listMembers('o1');
    expect(members.map((m) => [m.userId, m.role])).toEqual([['u1', 'org_admin'], ['u2', 'org_volunteer']]);
  });

  it('lists my organizations once each, with the strongest role', async () => {
    const { repo } = makeRepo({}, {
      data: [
        { org_id: 'o1', role: 'org_volunteer', organizations: { name: 'Org', slug: 'org' } },
        { org_id: 'o1', role: 'org_admin', organizations: { name: 'Org', slug: 'org' } },
      ],
      error: null,
    });
    expect(await repo.listMyOrganizations()).toEqual([
      { orgId: 'o1', name: 'Org', slug: 'org', role: 'org_admin' },
    ]);
  });

  it('reads the latest application, or null when there is none', async () => {
    const { repo } = makeRepo({}, {
      data: {
        application_id: 'a1', org_name: 'Org', status: 'approved', created_at: 'c',
        reviewed_at: 'r', review_note: null, org_id: 'o1',
      },
      error: null,
    });
    await expect(repo.getMyLatestApplication()).resolves.toMatchObject({ status: 'approved', orgId: 'o1' });
    const empty = makeRepo({}, { data: null, error: null });
    await expect(empty.repo.getMyLatestApplication()).resolves.toBeNull();
  });
});
