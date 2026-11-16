// Employment world, first slice (docs/spec/05_giving_worlds.md §5.11, #2278): A publishes a job offer
// and B finds it in the employment feed and in the main feed, where its owner is the one B would
// message. Runs while the world flag is off: the server does not gate publishing on it.
import { test, expect } from '@playwright/test';
import { cleanupE2eContent, rest, runTag, sessionFor } from '../lib/api';
import { publishPostAs } from '../lib/publish';
import { USER_A, USER_B } from '../lib/env';

test.describe.configure({ mode: 'serial' });

test.describe('employment world journey', () => {
  const title = `${runTag()} משרת סיוע במחסן`;
  let postId = '';

  test.afterAll(async () => {
    await cleanupE2eContent(USER_A);
  });

  test('A publishes a job offer', async () => {
    const post = await publishPostAs(USER_A, {
      world: 'employment',
      kindSlug: 'job_offer',
      title,
      publish: 'plain',
      details: () => ({ job_role: 'מחסנאי/ת', job_scope: 'job_part_time', job_area: 'תל אביב' }),
    });
    postId = post.id;
    expect(postId).not.toBe('');
  });

  test('B sees it in the employment feed and the main feed', async () => {
    const { session: a } = await sessionFor(USER_A);
    const ownerId = (a.user as { id: string }).id;
    const { session } = await sessionFor(USER_B);
    const token = session.access_token as string;
    const select = 'id,owner_id,world_slug,status,details';
    const inWorld = await rest<{ id: string; owner_id: string; details: Record<string, unknown> }[]>(
      token,
      `posts?select=${select}&id=eq.${postId}&world_slug=eq.employment&status=eq.open`,
    );
    expect(inWorld).toHaveLength(1);
    // The owner is the chat counterpart; the job fields travel in posts.details.
    expect(inWorld[0]!.owner_id).toBe(ownerId);
    expect(inWorld[0]!.details).toMatchObject({ job_role: 'מחסנאי/ת', job_scope: 'job_part_time' });
    const inMain = await rest<{ id: string }[]>(token, `posts?select=id&status=eq.open&order=created_at.desc&limit=50`);
    expect(inMain.map((p) => p.id)).toContain(postId);
  });
});
