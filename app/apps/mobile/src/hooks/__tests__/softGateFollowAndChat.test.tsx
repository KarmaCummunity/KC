// @vitest-environment jsdom
// FR-AUTH-015 (#1773 slice): soft gate must interrupt follow and chat-send for an
// incomplete profile (modal open, action deferred), and let a complete profile through.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { User } from '@kc/domain';

const m = vi.hoisted(() => ({
  onboardingState: 'completed' as string | null,
  missing: vi.fn(async () => false),
  forget: vi.fn(),
  setOnboarding: vi.fn(),
  reconcileExecute: vi.fn(async () => null as string | null),
  followExecute: vi.fn(async () => undefined),
  chatSend: vi.fn(async () => ({ messageId: 'server-1' })),
  hasSent: vi.fn(async () => true),
  append: vi.fn(),
  reconcile: vi.fn(),
  failed: vi.fn(),
  uuid: vi.fn(() => 'client-1'),
}));

vi.mock('../../store/authStore', () => ({
  useAuthStore: Object.assign(() => null, {
    getState: () => ({
      onboardingState: m.onboardingState,
      session: { userId: 'viewer' },
      setOnboardingState: m.setOnboarding,
    }),
  }),
}));
vi.mock('../../hooks/useDateOfBirthRequirement', () => ({
  useDateOfBirthRequirement: () => ({ isDateOfBirthMissing: m.missing, forgetDateOfBirthAnswer: m.forget }),
}));
vi.mock('../../services/userComposition', () => ({
  getReconcileDeferredBasicInfoUseCase: () => ({ execute: m.reconcileExecute }),
}));
vi.mock('../../components/OnboardingSoftGateModal', () => ({
  OnboardingSoftGateModal: ({ visible, onSaved }: { visible: boolean; onSaved: () => void }) =>
    visible ? <button type="button" onClick={onSaved}>basic info dialog</button> : null,
}));
vi.mock('../../components/DateOfBirthGateModal', () => ({
  DateOfBirthGateModal: ({ visible, onSaved }: { visible: boolean; onSaved: () => void }) =>
    visible ? <button type="button" onClick={onSaved}>date of birth dialog</button> : null,
}));
vi.mock('../../services/followComposition', () => Object.fromEntries(
  ['getFollowUserUseCase', 'getUnfollowUserUseCase', 'getSendFollowRequestUseCase', 'getCancelFollowRequestUseCase']
    .map((k) => [k, () => ({ execute: m.followExecute })]),
));
vi.mock('../../lib/container', () => ({
  container: { chatRepo: { hasSentAnyMessage: m.hasSent }, sendMessage: { execute: m.chatSend } },
}));
vi.mock('../../store/chatStore', () => ({
  useChatStore: { getState: () => ({ appendOptimistic: m.append, reconcileSent: m.reconcile, markFailed: m.failed }) },
}));
vi.mock('expo-crypto', () => ({ randomUUID: m.uuid }));
vi.mock('../../i18n', () => ({ default: { t: (k: string) => k } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import { SoftGateProvider } from '../../components/OnboardingSoftGate';
import { useOptimisticFollowAction } from '../useOptimisticFollowAction';
import { useChatSend } from '../useChatSend';

const target = { userId: 'target', privacyMode: 'Public' as const, followersCount: 2 } as unknown as User;

function wrap(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <SoftGateProvider>{children}</SoftGateProvider>
      </QueryClientProvider>
    );
  };
}

beforeEach(() => {
  m.onboardingState = 'completed';
  m.missing.mockResolvedValue(false);
  m.reconcileExecute.mockResolvedValue(null);
  vi.clearAllMocks();
});
afterEach(() => cleanup());

describe('FR-AUTH-015 soft gate on follow and chat send', () => {
  it('opens the gate and blocks follow for pending_basic_info; Save continues the follow', async () => {
    m.onboardingState = 'pending_basic_info';
    const client = new QueryClient();
    const { result } = renderHook(
      () => useOptimisticFollowAction({ viewerId: 'viewer', target, handle: 'handle' }),
      { wrapper: wrap(client) },
    );
    await act(async () => { result.current('follow'); });
    expect(m.followExecute).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'basic info dialog' }));
    await waitFor(() => expect(m.followExecute).toHaveBeenCalledWith({
      viewerId: 'viewer', targetUserId: 'target',
    }));
  });

  it('lets a complete profile follow without opening the gate', async () => {
    const client = new QueryClient();
    const { result } = renderHook(
      () => useOptimisticFollowAction({ viewerId: 'viewer', target, handle: 'handle' }),
      { wrapper: wrap(client) },
    );
    await act(async () => { await result.current('follow'); });
    await waitFor(() => expect(m.followExecute).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'basic info dialog' })).toBeNull();
  });

  it('opens the gate and blocks chat send for pending_basic_info; Save continues the send', async () => {
    m.onboardingState = 'pending_basic_info';
    const client = new QueryClient();
    const setInput = vi.fn();
    const { result } = renderHook(
      () => useChatSend({
        chatId: 'c1', userId: 'viewer', input: 'hello', setInput,
        presentPrePrompt: vi.fn(), setNotify: vi.fn(),
      }),
      { wrapper: wrap(client) },
    );
    await act(async () => { result.current(); });
    expect(m.chatSend).not.toHaveBeenCalled();
    expect(m.append).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'basic info dialog' }));
    await waitFor(() => expect(m.chatSend).toHaveBeenCalledWith({
      chatId: 'c1', senderId: 'viewer', body: 'hello', messageId: 'client-1',
    }));
  });

  it('lets a complete profile send a chat message without opening the gate', async () => {
    const client = new QueryClient();
    const { result } = renderHook(
      () => useChatSend({
        chatId: 'c1', userId: 'viewer', input: 'hi', setInput: vi.fn(),
        presentPrePrompt: vi.fn(), setNotify: vi.fn(),
      }),
      { wrapper: wrap(client) },
    );
    await act(async () => { result.current(); });
    await waitFor(() => expect(m.chatSend).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'basic info dialog' })).toBeNull();
  });
});
