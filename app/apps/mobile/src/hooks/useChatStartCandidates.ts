// FR-CHAT-017 — recipients for "start a conversation" (people I follow + name search).
import { useQuery } from '@tanstack/react-query';
import { container } from '../lib/container';
import { useDebouncedValue } from './useDebouncedValue';

const SEARCH_DEBOUNCE_MS = 300;

export function useChatStartCandidates(viewerId: string | null | undefined, query: string) {
  const trimmed = query.trim();
  const debounced = useDebouncedValue(trimmed, SEARCH_DEBOUNCE_MS);
  const result = useQuery({
    queryKey: ['chat', 'start-candidates', viewerId ?? '', debounced],
    queryFn: () => container.listChatStartCandidates.execute({ viewerId: viewerId!, query: debounced }),
    enabled: Boolean(viewerId),
    staleTime: 30_000,
    // Keep the previous list on screen while the next keystroke's search is in flight.
    placeholderData: (previous) => previous,
  });
  // The list on screen answers an older query until the debounce and the fetch both catch up.
  const pending = debounced !== trimmed || result.isPlaceholderData;
  return { query: result, pending };
}
