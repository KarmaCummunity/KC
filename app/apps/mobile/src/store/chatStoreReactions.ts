// Pure reducers for the chat store's message reactions (KC#873, #2568).
//
// Reactions live in the store per chat as `messageId → (userId → reaction)`. A message id that is
// present (even with an empty map) means "its reactions are known": the page's reactions are read
// once, a message created while the chat is open starts with none, and every later change arrives
// as a `reaction` broadcast. The screen reads `message_reactions` only for ids not present.
import type { MessageReactionType } from '@kc/domain';
import type { MessageReactionChange } from '@kc/application';

/** The reactions of one message: each member's single reaction, by user id. */
export type MessageReactions = Readonly<Record<string, MessageReactionType>>;

/** The known reactions of one chat, by message id. */
export type ChatReactions = Readonly<Record<string, MessageReactions>>;

/** One `message_reactions` row as the repository returns it. */
export interface MessageReactionRow {
  readonly messageId: string;
  readonly userId: string;
  readonly reactionType: MessageReactionType;
}

const NO_REACTIONS: MessageReactions = Object.freeze({});

/**
 * Stores what a read returned for `messageIds`: every listed id becomes known, with the rows that
 * belong to it (none = no reactions). Ids not listed keep what they had.
 */
export function withLoadedReactions(
  current: ChatReactions | undefined,
  messageIds: readonly string[],
  rows: readonly MessageReactionRow[],
): ChatReactions {
  const loaded: Record<string, Record<string, MessageReactionType>> = {};
  for (const id of messageIds) loaded[id] = {};
  for (const row of rows) {
    const forMessage = loaded[row.messageId];
    if (forMessage) forMessage[row.userId] = row.reactionType;
  }
  return { ...current, ...loaded };
}

/**
 * Marks messages created while the chat is open (sent or received) as having no reactions, so
 * they never cause a read. A message whose reactions are already known is left as it is.
 */
export function withNewMessages(current: ChatReactions | undefined, messageIds: readonly string[]): ChatReactions {
  const fresh = messageIds.filter((id) => id && !current?.[id]);
  if (fresh.length === 0 && current) return current;
  const next: Record<string, MessageReactions> = { ...current };
  for (const id of fresh) next[id] = NO_REACTIONS;
  return next;
}

/**
 * Applies one member's change. Returns `current` unchanged when the message's reactions are not
 * known yet: the read in flight for it will carry the change, and storing a partial map here
 * would mark the message as known and skip that read.
 */
export function withReactionChange(current: ChatReactions | undefined, change: MessageReactionChange): ChatReactions | undefined {
  const forMessage = current?.[change.messageId];
  if (!current || !forMessage) return current;
  if ((forMessage[change.userId] ?? null) === change.reactionType) return current;
  const { [change.userId]: _previous, ...others } = forMessage;
  const next: MessageReactions = change.reactionType ? { ...others, [change.userId]: change.reactionType } : others;
  return { ...current, [change.messageId]: next };
}
