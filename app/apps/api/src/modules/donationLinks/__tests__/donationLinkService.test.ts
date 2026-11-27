import { describe, expect, it, vi } from 'vitest';
import { type DonationLinkDeps, type LinkFields, type LinkMember, type LinkRow, type LinkStore, MAX_LINKS_PER_HOUR, submitDonationLink } from '../donationLinkService';

const member: LinkMember = { userId: 'member-1', isSuperAdmin: false };
const NOW = new Date('2026-11-21T10:00:00.000Z');
const body = { category_slug: 'food', url: 'https://give.example.org/donate', display_name: '  Food Bank  ', description: '  Meals  ' };

const row = (overrides: Partial<LinkRow> = {}): LinkRow => ({
  id: 'link-1',
  category_slug: 'food',
  url: 'https://give.example.org/donate',
  display_name: 'Food Bank',
  description: 'Meals',
  submitted_by: member.userId,
  validated_at: NOW.toISOString(),
  review_status: 'pending',
  review_note: null,
  created_at: NOW.toISOString(),
  updated_at: NOW.toISOString(),
  ...overrides,
});

/** A store that records what it was asked and answers from the given rows. */
function setup(options: { existing?: LinkRow | null; addedThisHour?: number; insertResult?: LinkRow | 'unknown_category' | null; reachable?: boolean } = {}) {
  const inserted: LinkFields[] = [];
  const updated: Array<{ id: string; fields: LinkFields }> = [];
  const counted: Array<{ userId: string; sinceIso: string }> = [];
  const links: LinkStore = {
    find: () => Promise.resolve(options.existing ?? null),
    update: (id, fields) => {
      updated.push({ id, fields });
      return Promise.resolve(row({ id, ...fields }));
    },
    countSince: (userId, sinceIso) => {
      counted.push({ userId, sinceIso });
      return Promise.resolve(options.addedThisHour ?? 0);
    },
    insert: (fields) => {
      inserted.push(fields);
      return Promise.resolve(options.insertResult === undefined ? row(fields) : options.insertResult);
    },
  };
  const checkReachable = vi.fn(() => Promise.resolve(options.reachable ?? true));
  const report = vi.fn();
  const deps: DonationLinkDeps = { links, checkReachable, report, now: () => NOW };
  return { deps, inserted, updated, counted, checkReachable, report };
}

describe('submitDonationLink', () => {
  it('answers a visitor unauthorized before anything else runs', async () => {
    const { deps, checkReachable, inserted } = setup();

    expect(await submitDonationLink(null, body, deps)).toEqual({ ok: false, code: 'unauthorized' });
    expect(checkReachable).not.toHaveBeenCalled();
    expect(inserted).toEqual([]);
  });

  it.each([
    ['a body that is not an object', 'x', 'invalid_input'],
    ['no giving world', { ...body, category_slug: '' }, 'invalid_input'],
    ['a name that is too short', { ...body, display_name: ' a ' }, 'invalid_input'],
    ['a name that is too long', { ...body, display_name: 'a'.repeat(81) }, 'invalid_input'],
    ['a description that is too long', { ...body, description: 'a'.repeat(281) }, 'invalid_input'],
    ['an address that is not http(s)', { ...body, url: 'ftp://give.example.org' }, 'invalid_url'],
    ['a private address', { ...body, url: 'http://169.254.169.254/latest/meta-data/' }, 'invalid_url'],
    ['an odd port', { ...body, url: 'https://give.example.org:8443/' }, 'invalid_url'],
  ])('rejects %s without fetching the address', async (_case, input, code) => {
    const { deps, checkReachable } = setup();

    expect(await submitDonationLink(member, input, deps)).toEqual({ ok: false, code });
    expect(checkReachable).not.toHaveBeenCalled();
  });

  it('reports an unreachable address and writes nothing', async () => {
    const { deps, inserted } = setup({ reachable: false });

    expect(await submitDonationLink(member, body, deps)).toEqual({ ok: false, code: 'unreachable' });
    expect(inserted).toEqual([]);
  });

  it('inserts a new link for the caller, trimmed and stamped as validated now, and returns it', async () => {
    const { deps, inserted, counted } = setup();

    const answer = await submitDonationLink(member, body, deps);

    expect(inserted).toEqual([
      {
        category_slug: 'food',
        url: 'https://give.example.org/donate',
        display_name: 'Food Bank',
        description: 'Meals',
        validated_at: NOW.toISOString(),
        submitted_by: member.userId,
      },
    ]);
    expect(answer).toMatchObject({ ok: true, link: { display_name: 'Food Bank', submitted_by: member.userId } });
    // The allowance is counted over the hour before now.
    expect(counted).toEqual([{ userId: member.userId, sinceIso: '2026-11-21T09:00:00.000Z' }]);
  });

  it('stores an empty description as none', async () => {
    const { deps, inserted } = setup();

    await submitDonationLink(member, { ...body, description: '   ' }, deps);

    expect(inserted[0]?.description).toBeNull();
  });

  it('accepts the tenth link within the hour and rate limits the eleventh', async () => {
    const tenth = setup({ addedThisHour: MAX_LINKS_PER_HOUR - 1 });
    const eleventh = setup({ addedThisHour: MAX_LINKS_PER_HOUR });

    expect((await submitDonationLink(member, body, tenth.deps)).ok).toBe(true);
    expect(await submitDonationLink(member, body, eleventh.deps)).toEqual({ ok: false, code: 'rate_limited' });
    expect(eleventh.inserted).toEqual([]);
  });

  it('answers invalid_input for an unknown giving world and server_error when nothing came back', async () => {
    expect(await submitDonationLink(member, body, setup({ insertResult: 'unknown_category' }).deps)).toEqual({ ok: false, code: 'invalid_input' });
    expect(await submitDonationLink(member, body, setup({ insertResult: null }).deps)).toEqual({ ok: false, code: 'server_error' });
  });

  it('reports a database failure for the log and tells the member only server_error', async () => {
    const { deps, report } = setup();
    const failure = new Error('connection lost: password=hunter2');
    deps.links.insert = () => Promise.reject(failure);

    const answer = await submitDonationLink(member, body, deps);

    expect(answer).toEqual({ ok: false, code: 'server_error' });
    expect(report).toHaveBeenCalledWith(failure, 'insert');
  });

  it('lets the submitter edit a link: it is updated, not inserted, and not rate limited', async () => {
    const { deps, inserted, updated, counted } = setup({ existing: row(), addedThisHour: MAX_LINKS_PER_HOUR });

    const answer = await submitDonationLink(member, { ...body, link_id: 'link-1', display_name: 'Food Bank TLV' }, deps);

    expect(answer).toMatchObject({ ok: true, link: { id: 'link-1', display_name: 'Food Bank TLV' } });
    expect(updated.map((change) => change.id)).toEqual(['link-1']);
    expect(updated[0]?.fields.submitted_by).toBeUndefined();
    expect(inserted).toEqual([]);
    expect(counted).toEqual([]);
  });

  it('refuses another member an edit, allows the super admin, and checks the link and its world', async () => {
    const others = row({ submitted_by: 'someone-else' });
    const edit = { ...body, link_id: 'link-1' };

    expect(await submitDonationLink(member, edit, setup({ existing: others }).deps)).toEqual({ ok: false, code: 'forbidden' });
    expect((await submitDonationLink({ userId: 'admin', isSuperAdmin: true }, edit, setup({ existing: others }).deps)).ok).toBe(true);
    expect(await submitDonationLink(member, edit, setup({ existing: null }).deps)).toEqual({ ok: false, code: 'invalid_input' });
    expect(await submitDonationLink(member, { ...edit, category_slug: 'items' }, setup({ existing: row() }).deps)).toEqual({ ok: false, code: 'invalid_input' });
  });
});
