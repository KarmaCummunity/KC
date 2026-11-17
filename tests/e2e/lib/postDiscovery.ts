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

/** The direct chat anchored on `postId` as the reader sees it (participant-only RLS); null when none. */
export async function anchoredChatId(token: string, postId: string): Promise<string | null> {
  const [chat] = await rest<{ id: string }[]>(token, `chats?select=id&kind=eq.direct&anchor_post_id=eq.${postId}&limit=1`);
  return chat?.id ?? null;
}

/** The bodies of the member messages of a chat, oldest first, as the reader sees them. */
export async function chatBodies(token: string, chatId: string): Promise<string[]> {
  const rows = await rest<{ body: string | null }[]>(
    token,
    `messages?select=body&chat_id=eq.${chatId}&kind=eq.user&order=created_at.asc`,
  );
  return rows.flatMap((row) => (row.body ? [row.body] : []));
}

/**
 * From the post page, opens a chat with its owner and sends `text`: the post page's chat button,
 * then the chat composer. Falls back to the Hebrew labels on a deployment without the testIDs.
 */
export async function messageOwnerFromPost(page: Page, text: string): Promise<void> {
  await page.getByTestId('listing-action-start-chat').first().click();
  const input = page.getByTestId('chat-input').or(page.getByPlaceholder('כתוב הודעה...')).first();
  await expect(input).toBeVisible({ timeout: 30_000 });
  await input.fill(text);
  await page.getByTestId('chat-send').click();
}
