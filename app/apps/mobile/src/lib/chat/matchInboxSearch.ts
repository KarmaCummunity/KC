// FR-CHAT-001 AC3 — inbox name search: case-insensitive prefix, niqqud-insensitive.
import { normalizeChatSearchText } from '@kc/domain';

/** True when `query` is empty or is a prefix of the counterpart display name (after normalize). */
export function matchesInboxNamePrefix(
  displayName: string | null | undefined,
  query: string,
): boolean {
  const needle = normalizeChatSearchText(query.trim());
  if (!needle) return true;
  return normalizeChatSearchText(displayName ?? '').startsWith(needle);
}
