// Opt-in, request-only deployed DEV diagnostic. No content or processor mutations.
import { test, expect } from '@playwright/test';
import { sessionFor } from '../lib/api';
import { BASE_URL, SUPABASE_URL, USER_D, anonKey } from '../lib/env';

test.use({ storageState: { cookies: [], origins: [] }, trace: 'off', video: 'off' });

test('observe an existing public post photo as a different authenticated member', async ({ request }, info) => {
  test.setTimeout(90_000);
  expect(BASE_URL).toBe('https://dev.karma-community.pages.dev');
  expect(SUPABASE_URL).toBe('https://enbqriuxvvuontiwslun.supabase.co');
  const postId = process.env.MEDIA_READONLY_POST_ID ?? '';
  test.skip(!postId, 'Opt-in diagnostic requires one existing post UUID.');
  expect(postId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  const { session } = await sessionFor(USER_D).catch(() => {
    throw new Error('DEV diagnostic member authentication failed (details withheld).');
  });
  const headers = { apikey: await anonKey(), Authorization: `Bearer ${session.access_token as string}` };
  const auth = await request.get(`${SUPABASE_URL}/auth/v1/user`, { headers });
  expect(auth.status(), 'normal member token accepted by DEV Auth').toBe(200);
  const principal = await auth.json() as { id: string; role: string };
  expect(principal.role).toBe('authenticated');
  const post = await request.get(`${SUPABASE_URL}/rest/v1/posts?id=eq.${postId}&select=id,owner_id,status,visibility`, { headers });
  expect(post.status(), 'existing post is readable').toBe(200);
  const posts = await post.json() as { id: string; owner_id: string; status: string; visibility: string }[];
  expect(posts.length, 'exactly the requested existing post is visible').toBe(1);
  expect(posts[0]!.owner_id, 'reader is not the photo owner').not.toBe(principal.id);
  expect(posts[0]!.visibility).toBe('Public');
  const media = await request.get(`${SUPABASE_URL}/rest/v1/post_media?post_id=eq.${postId}&select=id,processing_status`, { headers });
  expect(media.status(), 'member media metadata request answered').toBe(200);
  const rows = await media.json() as { id: string; processing_status: string }[];
  // This is an observation, not an assertion that missing metadata is a healthy photo result.
  // Manager-only baseline and object-existence checks are independent of this member response.
  await info.attach('member-media-readonly-observation', {
    body: JSON.stringify({ diagnosticOnly: true, photoAcceptancePassed: false, postId, memberId: principal.id,
      differentOwner: true, postStatus: posts[0]!.status, postVisibility: posts[0]!.visibility,
      authStatus: auth.status(), postHttpStatus: post.status(), mediaHttpStatus: media.status(),
      visibleMediaCount: rows.length, statuses: rows.map(row => row.processing_status),
      contentWrites: 0, processorInvocations: 0, traceRetained: false }),
    contentType: 'application/json',
  });
});
