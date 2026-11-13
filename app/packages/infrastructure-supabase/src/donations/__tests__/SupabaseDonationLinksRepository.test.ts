import { describe, expect, it } from 'vitest';
import { BackendUnavailableError } from '@kc/domain';
import { DonationLinkError } from '@kc/application';
import { callsTo, createFakeClient } from '../../__tests__/fakeBaselineClient';
import { fail, ok } from '../../posts/__tests__/cardFixtures';
import { SupabaseDonationLinksRepository } from '../SupabaseDonationLinksRepository';

const ROW = {
  id: 'l1', category_slug: 'food', url: 'https://a.example', display_name: 'A', description: null, submitted_by: 'u1',
  validated_at: '2026-01-01T00:00:00Z', review_status: 'approved', reviewed_by: null, reviewed_at: null, review_note: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
};

function clientWithFunction(result: { data: unknown; error: unknown }) {
  const base = createFakeClient({ tables: { donation_links: ok([ROW]) } });
  const invoked: unknown[] = [];
  const client = Object.assign(base.client, {
    functions: { invoke: async (name: string, init: unknown) => { invoked.push([name, init]); return result; } },
  });
  return { client, invoked, calls: base.calls };
}

describe('SupabaseDonationLinksRepository', () => {
  it('lists a category newest first and maps the review state', async () => {
    const { client, calls } = createFakeClient({ tables: { donation_links: ok([ROW]) } });
    const [link] = await new SupabaseDonationLinksRepository(client).listByCategory('food');
    expect(link).toMatchObject({ id: 'l1', categorySlug: 'food', displayName: 'A', reviewStatus: 'approved', submittedBy: 'u1' });
    expect(link).not.toHaveProperty('hiddenAt');
    expect(callsTo(calls, 'donation_links')[0]?.filters).toContainEqual(['eq', 'category_slug', 'food']);
  });

  it('adds a link through the validation function and returns the stored row', async () => {
    const { client, invoked } = clientWithFunction({ data: { ok: true, link: ROW }, error: null });
    const link = await new SupabaseDonationLinksRepository(client as never).addViaEdgeFunction({ categorySlug: 'food', url: 'https://a.example', displayName: 'A' });
    expect(link.id).toBe('l1');
    expect(invoked[0]).toEqual(['validate-donation-link', { body: { category_slug: 'food', url: 'https://a.example', display_name: 'A', description: null } }]);
  });

  it('turns a refused validation into the module\'s error code', async () => {
    const { client } = clientWithFunction({ data: { ok: false, code: 'unreachable' }, error: null });
    await expect(new SupabaseDonationLinksRepository(client as never).addViaEdgeFunction({ categorySlug: 'food', url: 'u', displayName: 'A' })).rejects.toMatchObject({ code: 'unreachable' });
  });

  it('deletes by id and reports through the support-thread RPC', async () => {
    const { client, calls } = createFakeClient({ tables: { donation_links: ok(null) }, rpc: { report_donation_link: ok(null) } });
    const repo = new SupabaseDonationLinksRepository(client);
    await repo.deleteById('l1');
    await repo.report('l1');
    expect(callsTo(calls, 'donation_links')[0]?.kind).toBe('delete');
    expect(callsTo(calls, 'report_donation_link')[0]?.args).toEqual({ p_link_id: 'l1' });
  });

  it('lists the review queue with the submitters\' names', async () => {
    const { client } = createFakeClient({
      tables: { donation_links: ok([{ ...ROW, review_status: 'pending' }]), users: ok([{ id: 'u1', display_name: 'Dana' }]) },
    });
    const [item] = await new SupabaseDonationLinksRepository(client).listForReview('pending');
    expect(item).toMatchObject({ id: 'l1', submitterName: 'Dana', reviewStatus: 'pending' });
  });

  it('reviews a link with the approve flag and a note', async () => {
    const { client, calls } = createFakeClient({ rpc: { admin_review_donation_link: ok('rejected') } });
    expect(await new SupabaseDonationLinksRepository(client).review('l1', false, 'broken')).toBe('rejected');
    expect(callsTo(calls, 'admin_review_donation_link')[0]?.args).toEqual({ p_link_id: 'l1', p_approve: false, p_note: 'broken' });
  });

  it('maps a staff refusal to forbidden, a rule reason to unknown and a missing object to the degrade error', async () => {
    const forbidden = createFakeClient({ rpc: { admin_review_donation_link: fail('42501', 'forbidden') } });
    await expect(new SupabaseDonationLinksRepository(forbidden.client).review('l1', true)).rejects.toMatchObject({ constructor: DonationLinkError, code: 'forbidden' });
    const rule = createFakeClient({ rpc: { admin_review_donation_link: fail('P0001', 'donation_link_not_pending') } });
    await expect(new SupabaseDonationLinksRepository(rule.client).review('l1', true)).rejects.toMatchObject({ code: 'unknown' });
    const missing = createFakeClient({ tables: { donation_links: fail('PGRST205', 'nope') } });
    await expect(new SupabaseDonationLinksRepository(missing.client).listByCategory('food')).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});
