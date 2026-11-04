// Errors of the knowledge topic graph (FR-KNOW-001). Codes mirror the database's error
// strings of migration 0570 so the UI maps each one to a localized message.
export type KnowledgeTopicErrorCode =
  | 'slug_invalid'
  | 'slug_taken'
  | 'parent_missing'
  | 'proposal_limit'
  | 'not_editable'
  | 'not_found'
  | 'already_merged'
  | 'not_proposed'
  | 'has_children'
  | 'merge_target_invalid'
  | 'merge_into_descendant'
  | 'alias_taken'
  | 'action_invalid'
  | 'unauthorized'
  | 'forbidden'
  | 'network'
  | 'unknown';

export class KnowledgeTopicError extends Error {
  readonly code: KnowledgeTopicErrorCode;
  readonly cause?: unknown;
  constructor(code: KnowledgeTopicErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'KnowledgeTopicError';
    this.code = code;
    this.cause = cause;
    Object.setPrototypeOf(this, KnowledgeTopicError.prototype);
  }
}

/** Safe across bundle duplicates (Metro may load @kc/application more than once). */
export function isKnowledgeTopicError(err: unknown): err is KnowledgeTopicError {
  if (err instanceof KnowledgeTopicError) return true;
  if (typeof err !== 'object' || err === null) return false;
  const o = err as { name?: string; code?: unknown };
  return o.name === 'KnowledgeTopicError' && typeof o.code === 'string';
}

/** Database error string → code; the RPCs raise exactly these names (migration 0570). */
const DB_MESSAGE_CODES: ReadonlyArray<readonly [string, KnowledgeTopicErrorCode]> = [
  ['knowledge_topic_slug_invalid', 'slug_invalid'],
  ['knowledge_topic_slug_taken', 'slug_taken'],
  ['knowledge_topic_parent_missing', 'parent_missing'],
  ['knowledge_topic_parent_merged', 'merge_target_invalid'],
  ['knowledge_topic_proposal_limit', 'proposal_limit'],
  ['knowledge_topic_not_editable', 'not_editable'],
  ['knowledge_topic_not_found', 'not_found'],
  ['knowledge_topic_already_merged', 'already_merged'],
  ['knowledge_topic_not_proposed', 'not_proposed'],
  ['knowledge_topic_has_children', 'has_children'],
  ['knowledge_topic_merge_target_invalid', 'merge_target_invalid'],
  ['knowledge_topic_merge_into_descendant', 'merge_into_descendant'],
  ['knowledge_topic_alias_taken', 'alias_taken'],
  ['knowledge_topic_action_invalid', 'action_invalid'],
  ['auth_required', 'unauthorized'],
  ['forbidden', 'forbidden'],
];

/**
 * Maps a failed database call to a `KnowledgeTopicError`. A message that names one of the
 * RPC errors gets its code; anything else is `network` (the call never got an answer) or
 * `unknown`, with the original error kept as `cause` for logging.
 */
export function knowledgeTopicErrorFromDb(error: { message?: string | null } | null | undefined): KnowledgeTopicError {
  const message = error?.message ?? '';
  for (const [needle, code] of DB_MESSAGE_CODES) {
    if (message.includes(needle)) return new KnowledgeTopicError(code, message, error);
  }
  if (/fetch|network|timeout/i.test(message)) return new KnowledgeTopicError('network', message, error);
  return new KnowledgeTopicError('unknown', message || 'Unknown knowledge topic error', error);
}
