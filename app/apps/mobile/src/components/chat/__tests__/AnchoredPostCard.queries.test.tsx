// @vitest-environment jsdom
// #2566 / FR-CHAT-014 AC7 — the counterpart's phone is shown only inside the anchored-post card,
// so its chat-scoped RPC runs only for a chat with an anchored post.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render } from '@testing-library/react';

const m = vi.hoisted(() => ({ queries: [] as Array<{ queryKey: readonly unknown[]; enabled?: boolean }> }));

// Record every query the card declares; no data, so the card renders nothing.
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey: readonly unknown[]; enabled?: boolean }) => {
    m.queries.push(options);
    return { data: undefined };
  },
  useQueryClient: () => ({ invalidateQueries: () => Promise.resolve() }),
}));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: () => undefined }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('../../../services/postsComposition', () => ({ getPostByIdUseCase: () => ({ execute: vi.fn() }) }));
vi.mock('../../../services/userComposition', () => ({ getUserRepo: () => ({ getChatCounterpartyContact: vi.fn() }) }));
vi.mock('../../../store/chatStore', () => ({ useChatStore: () => undefined }));
vi.mock('../../../store/closureStore', () => ({
  useClosureStore: (select: (s: Record<string, unknown>) => unknown) =>
    select({ start: vi.fn(), step: 'idle', initiator: null, reset: vi.fn() }),
}));
vi.mock('../../closure/ClosureSheet', () => ({ ClosureSheet: () => null }));
vi.mock('../../closure/ClosureExplainerSheet', () => ({ ClosureExplainerSheet: () => null }));
vi.mock('../../cards/KcRowCard', () => ({ KcRowCard: () => null }));
vi.mock('../../../lib/invalidatePersonalStatsCaches', () => ({ invalidatePersonalStatsCaches: vi.fn() }));
vi.mock('../../../lib/invalidateMyProfilePostQueries', () => ({ invalidateMyProfilePostQueries: vi.fn() }));
vi.mock('../../../lib/trackSocialHandoverCompleted', () => ({ trackSocialHandoverCompleted: vi.fn() }));
vi.mock('../../../lib/haptics', () => ({ hapticSuccess: vi.fn() }));
vi.mock('../../../lib/imageUrl', () => ({ getSupabaseImageThumbUrl: vi.fn(), getSupabasePublicImageUrl: vi.fn() }));

import { AnchoredPostCard } from '../AnchoredPostCard';

/** The `enabled` flag the card gave the query whose key starts with `name`. */
const enabledOf = (name: string) => m.queries.find((q) => q.queryKey[0] === name)?.enabled;

describe('AnchoredPostCard queries', () => {
  afterEach(() => {
    cleanup();
    m.queries = [];
  });

  it('skips the counterpart contact RPC for a chat without an anchored post', () => {
    render(<AnchoredPostCard chatId="c1" anchorPostId={null} viewerId="me" counterpartId="peer" />);
    expect(enabledOf('chat-counterparty-contact')).toBe(false);
    expect(enabledOf('post')).toBe(false);
  });

  it('loads the post and the counterpart contact in parallel for an anchored chat', () => {
    render(<AnchoredPostCard chatId="c1" anchorPostId="p1" viewerId="me" counterpartId="peer" />);
    expect(enabledOf('post')).toBe(true);
    expect(enabledOf('chat-counterparty-contact')).toBe(true);
  });

  it('skips the contact RPC when the counterpart is gone', () => {
    render(<AnchoredPostCard chatId="c1" anchorPostId="p1" viewerId="me" counterpartId={null} />);
    expect(enabledOf('chat-counterparty-contact')).toBe(false);
  });
});
