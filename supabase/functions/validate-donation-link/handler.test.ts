import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { createDonationLinkHandler, type LinkFields, type LinkRow, type LinkStore, type Member } from './handler.ts';

const MEMBER: Member = { userId: 'u1', isSuperAdmin: false };
const INPUT = { category_slug: 'food', url: 'https://example.org/help', display_name: 'Food bank', description: 'Weekly boxes' };

const row = (over: Partial<LinkRow> = {}): LinkRow => ({
  id: 'l1', category_slug: 'food', url: 'https://example.org/help', display_name: 'Food bank', description: null,
  submitted_by: 'u1', validated_at: '2026-11-11T00:00:00Z', review_status: 'pending', review_note: null,
  created_at: '2026-11-11T00:00:00Z', updated_at: '2026-11-11T00:00:00Z', ...over,
});

interface Setup { member?: Member | null; reachable?: boolean; stored?: LinkRow | null; recent?: number; insertResult?: LinkRow | 'unknown_category' | null; throwOn?: keyof LinkStore }

function setup(o: Setup = {}) {
  const calls: string[] = [];
  let sentFields: LinkFields | null = null;
  const guard = (name: keyof LinkStore) => {
    calls.push(name);
    if (o.throwOn === name) throw new Error('db down');
  };
  const links: LinkStore = {
    find: (id) => { guard('find'); return Promise.resolve(o.stored === undefined ? row({ id }) : o.stored); },
    update: (id, fields) => { guard('update'); sentFields = fields; return Promise.resolve(row({ id, ...fields })); },
    countSince: () => { guard('countSince'); return Promise.resolve(o.recent ?? 0); },
    insert: (fields) => {
      guard('insert');
      sentFields = fields;
      return Promise.resolve(o.insertResult === undefined ? row({ ...fields }) : o.insertResult);
    },
  };
  const handler = createDonationLinkHandler({
    authenticate: (header) => { calls.push('authenticate'); return Promise.resolve(header && o.member !== null ? (o.member ?? MEMBER) : null); },
    checkReachable: () => { calls.push('reachable'); return Promise.resolve(o.reachable ?? true); },
    links,
    report: () => Promise.resolve(),
    now: () => new Date('2026-11-11T12:00:00Z'),
  });
  return { handler, calls, sent: () => sentFields };
}

const post = (body: unknown, auth: string | null = 'Bearer jwt') =>
  new Request('http://x/validate-donation-link', {
    method: 'POST',
    headers: auth ? { Authorization: auth } : {},
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
const code = async (res: Response) => (await res.json()).code;

Deno.test('answers the CORS preflight and refuses other methods', async () => {
  const { handler } = setup();
  assertEquals((await handler(new Request('http://x', { method: 'OPTIONS' }))).status, 200);
  assertEquals((await handler(new Request('http://x', { method: 'GET' }))).status, 405);
});

Deno.test('an unauthenticated caller gets code unauthorized before anything else runs', async () => {
  for (const auth of [null, 'Basic abc']) {
    const { handler, calls } = setup();
    assertEquals(await code(await handler(post(INPUT, auth))), 'unauthorized');
    assertEquals(calls.includes('reachable'), false);
  }
  const { handler: bad, calls } = setup({ member: null });
  assertEquals(await code(await bad(post(INPUT))), 'unauthorized');
  assertEquals(calls.includes('insert'), false);
});

Deno.test('rejects malformed input with invalid_input / invalid_url, without fetching the address', async () => {
  const cases: [unknown, string][] = [
    ['not json', 'invalid_input'],
    [{ ...INPUT, category_slug: '' }, 'invalid_input'],
    [{ ...INPUT, display_name: 'x' }, 'invalid_input'],
    [{ ...INPUT, display_name: 'x'.repeat(81) }, 'invalid_input'],
    [{ ...INPUT, description: 'x'.repeat(281) }, 'invalid_input'],
    [{ ...INPUT, url: 'ftp://example.org' }, 'invalid_url'],
    [{ ...INPUT, url: 'http://169.254.169.254/' }, 'invalid_url'],
  ];
  for (const [body, expected] of cases) {
    const { handler, calls } = setup();
    assertEquals(await code(await handler(post(body))), expected, JSON.stringify(body));
    assertEquals(calls.includes('reachable'), false);
  }
});

Deno.test('an unreachable address is reported and nothing is written', async () => {
  const { handler, calls } = setup({ reachable: false });
  assertEquals(await code(await handler(post(INPUT))), 'unreachable');
  assertEquals(calls.includes('insert'), false);
});

Deno.test('a new link is inserted for the caller, stamped as validated now, trimmed, and returned', async () => {
  const { handler, sent } = setup();
  const body = await (await handler(post({ ...INPUT, display_name: '  Food bank ', description: '  ' }))).json();
  assertEquals(body.ok, true);
  assertEquals(body.link.review_status, 'pending');
  assertEquals(sent(), {
    category_slug: 'food', url: 'https://example.org/help', display_name: 'Food bank', description: null,
    validated_at: '2026-11-11T12:00:00.000Z', submitted_by: 'u1',
  });
});

Deno.test('the tenth link within the hour is accepted, the eleventh is rate limited', async () => {
  assertEquals((await (await setup({ recent: 9 }).handler(post(INPUT))).json()).ok, true);
  const { handler, calls } = setup({ recent: 10 });
  assertEquals(await code(await handler(post(INPUT))), 'rate_limited');
  assertEquals(calls.includes('insert'), false);
});

Deno.test('an unknown giving world is invalid_input; a database failure is server_error', async () => {
  assertEquals(await code(await setup({ insertResult: 'unknown_category' }).handler(post(INPUT))), 'invalid_input');
  assertEquals(await code(await setup({ throwOn: 'insert' }).handler(post(INPUT))), 'server_error');
  assertEquals(await code(await setup({ throwOn: 'countSince' }).handler(post(INPUT))), 'server_error');
});

Deno.test('the submitter edits a link: it is updated, not inserted, and not rate limited', async () => {
  const { handler, calls, sent } = setup({ recent: 50 });
  const res = await (await handler(post({ ...INPUT, link_id: 'l1', display_name: 'New name' }))).json();
  assertEquals(res.ok, true);
  assertEquals(res.link.display_name, 'New name');
  assertEquals(calls.includes('insert'), false);
  assertEquals(sent()?.display_name, 'New name');
  assertEquals('submitted_by' in (sent() ?? {}), false);
});

Deno.test('editing is refused for another member, allowed for the super admin, and checks the link and its world', async () => {
  const foreign = row({ submitted_by: 'someone-else' });
  assertEquals(await code(await setup({ stored: foreign }).handler(post({ ...INPUT, link_id: 'l1' }))), 'forbidden');
  const admin = setup({ stored: foreign, member: { userId: 'u9', isSuperAdmin: true } });
  assertEquals((await (await admin.handler(post({ ...INPUT, link_id: 'l1' }))).json()).ok, true);
  assertEquals(await code(await setup({ stored: null }).handler(post({ ...INPUT, link_id: 'nope' }))), 'invalid_input');
  assertEquals(await code(await setup({ stored: row({ category_slug: 'money' }) }).handler(post({ ...INPUT, link_id: 'l1' }))), 'invalid_input');
  assertEquals(await code(await setup({ throwOn: 'update' }).handler(post({ ...INPUT, link_id: 'l1' }))), 'server_error');
});
