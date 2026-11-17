/**
 * How a second member finds and contacts a published post, checked through the server the way
 * the app reads it (FR-FEED-001, D165; FR-CHAT-014). Shared by the world journeys (#1027).
 */
import { expect, type Page } from '@playwright/test';
import { rest } from './api';

interface FeedRow {
  readonly card: { readonly id: string };
}

/**
 * A boolean read as a value for `expect.poll`: `yes`, `no`, or the server's error. A poll ends on
 * the first read that throws, and kc-dev cancels some statements at its 8 s timeout while it is
 * busy (#2368). These checks prove that a post is found and a message arrives, not how fast, so
 * a failed read is polled again like a `no`, and still shows as the received value when the
 * check never passes.
 */
export async function seen(read: () => Promise<boolean>): Promise<string> {
  try {
    return (await read()) ? 'yes' : 'no';
  } catch (error) {
    return `read failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * True when `feed_page`, called as the viewer, returns `postId` for its own title. `q` narrows the
 * page to that title while keeping the feed's rules (the main feed: worlds shown there, minus the
 * viewer's mutes; a world's feed: that world only), and `newest` puts a fresh post first.
 */
export async function feedShows(
  token: string,
  postId: string,
  title: string,
  world: string | null,
): Promise<boolean> {
  const filters = { q: title, sort: 'newest', ...(world ? { world } : {}) };
  const rows = await rest<FeedRow[]>(token, 'rpc/feed_page', {
    method: 'POST',
    body: { p_cursor: null, p_limit: 20, p_filters: filters },
  });
  return rows.some((row) => row.card?.id === postId);
}

/**
 * True when the direct chat anchored on `postId` holds a member message with exactly `body`, as
 * the reader sees it (participant-only RLS). Two members share one chat, re-anchored on each
 * post they talk about and longer after every run, so the message is looked up by its body
 * rather than read out of the whole thread.
 */
export async function anchoredChatHolds(token: string, postId: string, body: string): Promise<boolean> {
  const [chat] = await rest<{ id: string }[]>(token, `chats?select=id&kind=eq.direct&anchor_post_id=eq.${postId}&limit=1`);
  if (!chat) return false;
  const rows = await rest<{ body: string }[]>(
    token,
    `messages?select=body&chat_id=eq.${chat.id}&kind=eq.user&body=eq.${encodeURIComponent(body)}&limit=1`,
  );
  return rows.length > 0;
}

/**
 * From the post page, opens a chat with its owner and sends `text`: the post page's chat button,
 * then the chat composer. Falls back to the Hebrew labels on a deployment without the testIDs.
 */
export async function messageOwnerFromPost(page: Page, text: string): Promise<void> {
  // /post/[id] is two pages: a listing-world post (food, animals) shows the listing's chat
  // action, an items post shows the generic page, whose contact button (`post.detail.contactA11y`)
  // has no testID and is found by its accessible name. The composer may open prefilled with the
  // app's opening line; `fill` replaces it.
  const contact = page
    .getByTestId('listing-action-start-chat')
    .or(page.getByRole('button', { name: 'שלחו הודעה למפרסם', exact: true }));
  await contact.first().click();
  const input = page.getByTestId('chat-input').or(page.getByPlaceholder('כתוב הודעה...')).first();
  await expect(input).toBeVisible({ timeout: 30_000 });
  await input.fill(text);
  await page.getByTestId('chat-send').click();
}
