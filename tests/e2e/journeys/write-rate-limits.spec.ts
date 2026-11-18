// SEC-WRITE-RATE-LIMITS (KC#1662) — write rate limits, checked on the deployed kc-dev project.
//
// A member may repeat a limited write only so often (`kc_private.rate_limits`; new posts, drafts
// included: 20 an hour). `supabase/tests/095_platform.sql` proves every limited action on a
// scratch database, where the limit can be lowered to two. On the deployed database nobody can
// lower it from outside, so this journey proves the limiter through the one write that can pass
// the limit in a single request: an insert of 21 drafts. The rows of one insert are one statement,
// so refusing the 21st row rolls all of them back: nothing is created and nothing is counted, and
// the journey can run any number of times an hour. One draft right after shows that the limiter
// is not simply refusing every write.
//
// Handoff requests (30 an hour) and follows (100 an hour) use the same limiter; reaching them
// would take that many real writes on kc-dev every night, so they stay with the pgTAP suite.
//
// It runs as a member no other journey signs in as (user4 of the seed), so the quota of the
// members who publish in the other journeys is untouched. No browser.
import { test, expect } from '@playwright/test';
import { rest, runTag, sessionFor } from '../lib/api';
import { SUPABASE_URL, USER_D, anonKey } from '../lib/env';

/** The `post_create` limit of the baseline (`kc_private.rate_limits`): new posts per member per hour. */
const POSTS_PER_HOUR = 20;

interface Member {
  readonly token: string;
  readonly id: string;
}

/** The rows of a draft the way the create form inserts one (`lib/publish.ts`), `count` of them. */
async function drafts(member: Member, title: string, count: number): Promise<Record<string, unknown>[]> {
  const [kind] = await rest<{ id: string; direction: string }[]>(
    member.token,
    'post_kinds?select=id,direction&world_slug=eq.items&slug=eq.item_offer&limit=1',
  );
  if (!kind) throw new Error('post kind items/item_offer is missing on kc-dev');
  return Array.from({ length: count }, (_, n) => ({
    world_slug: 'items',
    kind_id: kind.id,
    direction: kind.direction,
    title: `${title} ${n + 1}`,
    description: null,
    city_id: '7400',
    owner_id: member.id,
    post_type: 'standard',
    status: 'draft',
    details: {},
  }));
}

/** The member's drafts whose title starts with `title`, as the member sees them. */
const draftsTitled = (member: Member, title: string) =>
  rest<{ id: string }[]>(member.token, `posts?select=id&owner_id=eq.${member.id}&status=eq.draft&title=like.${encodeURIComponent(`${title}*`)}`);

test.describe.serial('write rate limits: new posts', () => {
  const title = `${runTag()} rate limit draft`;
  let member: Member;

  test.beforeAll(async () => {
    const { session } = await sessionFor(USER_D);
    member = { token: session.access_token as string, id: (session.user as { id: string }).id };
  });

  test('one request for more posts than the hourly limit is refused whole, and creates nothing', async () => {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/posts`, {
      method: 'POST',
      headers: { apikey: await anonKey(), Authorization: `Bearer ${member.token}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(await drafts(member, title, POSTS_PER_HOUR + 1)),
    });
    const body = (await response.json().catch(() => null)) as { code?: string; message?: string; details?: string } | null;
    // The limiter's own refusal: SQLSTATE P0001, `rate_limited`, and the action in the detail.
    expect({ status: response.status, code: body?.code, message: body?.message, details: body?.details }).toEqual({
      status: 400,
      code: 'P0001',
      message: 'rate_limited',
      details: 'post_create',
    });
    expect(await draftsTitled(member, title), 'drafts left by the refused request').toEqual([]);
  });

  test('a single post inside the limit is still accepted', async () => {
    const [created] = await rest<{ id: string }[]>(member.token, 'posts', { method: 'POST', body: (await drafts(member, title, 1))[0] });
    expect(created?.id, 'the draft was created').toBeTruthy();
  });

  test.afterAll(async () => {
    // A member may delete their own drafts; best effort, so a failed cleanup never fails the suite.
    if (!member) return;
    await rest(member.token, `posts?owner_id=eq.${member.id}&status=eq.draft&title=like.${encodeURIComponent(`${title}*`)}`, { method: 'DELETE' }).catch(() => undefined);
  });
});
