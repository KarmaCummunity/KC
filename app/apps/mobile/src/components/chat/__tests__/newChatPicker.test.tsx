// @vitest-environment jsdom
// FR-CHAT-017 — the Inbox "+" opens the recipient picker; the picker lists the people I follow,
// then other people found by name, and choosing one opens (or reuses) the pair's thread.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../navigation/shellStackScreenOptions', () => ({ useShellStackScreenOptions: () => ({}) }));
import React from 'react';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderInTheme } from '../../ui/__tests__/kitDialogTestKit';
import type { User } from '@kc/domain';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  execute: vi.fn(),
  openOrCreate: vi.fn(),
}));

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
  Stack: { Screen: () => null },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: { name?: string }) => (o?.name ? `${k}:${o.name}` : k), i18n: { language: 'he' } }),
}));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('../../../lib/container', () => ({
  container: {
    listChatStartCandidates: { execute: mocks.execute },
    openOrCreateChat: { execute: mocks.openOrCreate },
  },
}));
vi.mock('../../../store/authStore', () => ({
  useAuthStore: (sel: (s: { session: { userId: string } }) => unknown) => sel({ session: { userId: 'me' } }),
}));
vi.mock('../../AvatarInitials', () => ({ AvatarInitials: () => null }));
vi.mock('../../filterKit/FilterSearchBar', () => ({
  FilterSearchBar: ({ value, onChangeText, testID }: { value: string; onChangeText: (t: string) => void; testID?: string }) => (
    <input data-testid={testID} value={value} onChange={(e) => onChangeText(e.target.value)} />
  ),
}));
vi.mock('../../EmptyState', () => ({
  EmptyState: ({ title }: { title: string }) => <div data-testid="empty">{title}</div>,
}));
vi.mock('../../ui/Buttons', () => ({ PrimaryButton: () => null }));
vi.mock('../../NotifyModal', () => ({
  NotifyModal: ({ visible, message }: { visible: boolean; message: string }) =>
    visible ? <div data-testid="notify">{message}</div> : null,
}));
vi.mock('../../../navigation/NativeStackHeaderTitle', () => ({ NativeStackHeaderTitle: () => null }));
vi.mock('../../../navigation/detailStackScreenOptions', () => ({ useDetailStackScreenOptions: () => ({}) }));
vi.mock('../../../components/RouteErrorBoundary', () => ({ RouteErrorBoundary: () => null }));

import NewChatScreen from '../../../../app/chat/new';
import { NewChatHeaderButton } from '../NewChatHeaderButton';

const user = (userId: string, displayName: string) =>
  ({ userId, displayName, avatarUrl: null, shareHandle: userId }) as unknown as User;

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderInTheme(
    <QueryClientProvider client={client}>
      <NewChatScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.execute.mockResolvedValue({ following: [user('a', 'Avi')], others: [user('c', 'Carmit')] });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('chat inbox "+" and new-conversation picker (FR-CHAT-017)', () => {
  it('AC1: the "+" opens the picker route', () => {
    renderInTheme(<NewChatHeaderButton />);
    fireEvent.click(screen.getByTestId('chat-inbox-new'));
    expect(mocks.push).toHaveBeenCalledWith('/chat/new');
  });

  it('AC2/AC3: shows the followed people, then the other people, under their own headings', async () => {
    renderScreen();
    await screen.findByTestId('chat-recipient-a');
    expect(mocks.execute).toHaveBeenCalledWith({ viewerId: 'me', query: '' });
    const text = screen.getByTestId('chat-new-screen').textContent ?? '';
    expect(text.indexOf('chat.new.followingSection')).toBeLessThan(text.indexOf('chat.new.othersSection'));
    expect(screen.getByTestId('chat-recipient-c')).toBeTruthy();
  });

  it('AC5: choosing a person opens the pair thread without an anchor and replaces the picker', async () => {
    mocks.openOrCreate.mockResolvedValue({ chatId: 'chat-9' });
    renderScreen();
    fireEvent.click(await screen.findByTestId('chat-recipient-a'));
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith({ pathname: '/chat/[id]', params: { id: 'chat-9' } }),
    );
    expect(mocks.openOrCreate).toHaveBeenCalledWith({ viewerId: 'me', otherUserId: 'a' });
  });

  it('AC5: a failure to open the thread tells the user and stays on the picker', async () => {
    mocks.openOrCreate.mockRejectedValue(new Error('blocked'));
    renderScreen();
    fireEvent.click(await screen.findByTestId('chat-recipient-a'));
    expect((await screen.findByTestId('notify')).textContent).toBe('chat.new.openError');
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('AC6: no one followed and no query shows the hint to search by name', async () => {
    mocks.execute.mockResolvedValue({ following: [], others: [] });
    renderScreen();
    expect((await screen.findByTestId('empty')).textContent).toBe('chat.new.emptyTitle');
  });

  it('AC6: a query without matches says so', async () => {
    mocks.execute.mockResolvedValue({ following: [], others: [] });
    renderScreen();
    fireEvent.change(screen.getByTestId('chat-new-search'), { target: { value: 'zzz' } });
    await waitFor(() => expect(screen.getByTestId('empty').textContent).toBe('chat.new.noResults'));
    expect(mocks.execute).toHaveBeenLastCalledWith({ viewerId: 'me', query: 'zzz' });
  });
});
