// @vitest-environment jsdom
// Time-giving (volunteer) screens on the kit buttons and fields (spec 17 §4.1.1, TD-243): each call
// to action runs its use case and keeps its disabled / busy rules; closing is a danger button (D94).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@kc/ui';

const { router, execute, supportChat } = vi.hoisted(() => ({
  router: { back: vi.fn(), push: vi.fn(), replace: vi.fn() },
  execute: {
    getDetail: vi.fn(),
    signUp: vi.fn(),
    close: vi.fn(),
    messageVolunteers: vi.fn(),
    createOpportunity: vi.fn(),
    addShift: vi.fn(),
    publish: vi.fn(),
    listOrganizer: vi.fn(),
  },
  supportChat: { getSupportThread: vi.fn(), sendMessage: vi.fn() },
}));

vi.mock('react-native-reanimated', async () => (await import('../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('@expo/vector-icons', async () => (await import('../ui/__tests__/kitDialogTestKit')).iconsDouble);
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'he' } }) }));
vi.mock('../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('expo-router', () => ({ useRouter: () => router, useLocalSearchParams: () => ({ opportunityId: 'o_1' }) }));
vi.mock('../ui/Screen', () => ({ Screen: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('../lists/KcFlashList', () => ({ KcFlashList: ({ ListHeaderComponent }: { ListHeaderComponent: React.ReactNode }) => ListHeaderComponent }));
vi.mock('../cards/KcRowCard', () => ({ KcRowCard: () => null }));
vi.mock('../../navigation/useShellTabBarVisibility', () => ({ useShellTabBarScrollInset: () => 0 }));
vi.mock('@react-native-community/datetimepicker', () => ({ default: () => null }));
vi.mock('../../store/authStore', () => ({
  useAuthStore: (select: (s: unknown) => unknown) => select({ session: { userId: 'u_me' } }),
}));
vi.mock('../../lib/container', () => ({
  container: {
    getSupportThread: { execute: (...args: unknown[]) => supportChat.getSupportThread(...args) },
    sendMessage: { execute: (...args: unknown[]) => supportChat.sendMessage(...args) },
  },
}));
vi.mock('../../services/volunteerComposition', () => ({
  volunteerUseCases: Object.fromEntries(
    Object.entries(execute).map(([name, fn]) => [name, () => ({ execute: fn })]),
  ),
}));

import OpportunityScreen from '../../../app/(tabs)/donations/time/opportunity/[opportunityId]';
import OrganizerManageScreen from '../../../app/(tabs)/donations/time/organizer/[opportunityId]';
import OrganizerListScreen from '../../../app/(tabs)/donations/time/organizer/index';
import CreateOpportunityScreen from '../../../app/(tabs)/donations/time/organizer/create';
import SupportComposerScreen from '../../../app/(tabs)/donations/time/support';

const SHIFT = { shiftId: 's_1', startsAt: '2026-11-02T08:00:00Z', endsAt: '2026-11-02T10:00:00Z', capacity: 4, filled: 1, slotsOpen: 3, myStatus: null };
const DETAIL = { opportunityId: 'o_1', organizerId: 'u_org', title: 'Food bank', summary: null, locationLabel: null, shifts: [SHIFT] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  execute.getDetail.mockResolvedValue(DETAIL);
});
afterEach(cleanup);

function renderScreen(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>{ui}</ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('volunteer opportunity', () => {
  it('signs up to a shift and blocks that button while the sign-up runs', async () => {
    let settle: () => void = () => {};
    execute.signUp.mockReturnValueOnce(new Promise<void>((resolve) => { settle = resolve; }));
    const { findByRole } = renderScreen(<OpportunityScreen />);
    const signUp = await findByRole('button', { name: 'timeVolunteer.signUp' });
    fireEvent.click(signUp);
    expect(execute.signUp).toHaveBeenCalledWith('s_1');
    await vi.waitFor(() => expect(signUp.getAttribute('aria-disabled')).toBe('true'));
    await act(async () => settle());
    await vi.waitFor(() => expect(signUp.getAttribute('aria-disabled')).not.toBe('true'));
  });
});

describe('organizer screens', () => {
  it('closes the opportunity from a danger button and goes back', async () => {
    execute.close.mockResolvedValue(undefined);
    const { findByRole } = renderScreen(<OrganizerManageScreen />);
    fireEvent.click(await findByRole('button', { name: 'timeVolunteer.closeOpportunity' }));
    expect(execute.close).toHaveBeenCalledWith('o_1');
    await vi.waitFor(() => expect(router.back).toHaveBeenCalled());
  });

  it('opens the message composer from a shift and sends the typed message', async () => {
    execute.messageVolunteers.mockResolvedValue(3);
    const { findByRole, getByRole } = renderScreen(<OrganizerManageScreen />);
    fireEvent.click(await findByRole('button', { name: 'timeVolunteer.messageVolunteers' }));
    fireEvent.change(getByRole('textbox', { name: 'timeVolunteer.messageVolunteers' }), { target: { value: ' See you at 8 ' } });
    fireEvent.click(getByRole('button', { name: 'timeVolunteer.sendMessage' }));
    expect(execute.messageVolunteers).toHaveBeenCalledWith('s_1', 'See you at 8');
  });

  it('opens the create form from the list header', () => {
    execute.listOrganizer.mockResolvedValue([]);
    const { getByRole } = renderScreen(<OrganizerListScreen />);
    fireEvent.click(getByRole('button', { name: 'timeVolunteer.createOpportunity' }));
    expect(router.push).toHaveBeenCalledWith('/(tabs)/donations/time/organizer/create');
  });

  it('publishes a new opportunity once and blocks the button meanwhile', async () => {
    let settle: (id: string) => void = () => {};
    execute.createOpportunity.mockReturnValueOnce(new Promise<string>((resolve) => { settle = resolve; }));
    const { getByRole, getByLabelText } = renderScreen(<CreateOpportunityScreen />);
    fireEvent.change(getByLabelText('timeVolunteer.fieldTitle'), { target: { value: 'Beach clean-up' } });
    const publish = getByRole('button', { name: 'timeVolunteer.publish' });
    fireEvent.click(publish);
    expect(execute.createOpportunity).toHaveBeenCalledWith({ title: 'Beach clean-up', summary: null, locationLabel: null });
    await vi.waitFor(() => expect(publish.getAttribute('aria-disabled')).toBe('true'));
    await act(async () => settle('o_2'));
    await vi.waitFor(() => expect(router.replace).toHaveBeenCalled());
  });
});

describe('support composer', () => {
  it('needs text before sending and shows a spinner while the message goes out', async () => {
    let settle: () => void = () => {};
    supportChat.getSupportThread.mockResolvedValue({ chatId: 'c_1' });
    supportChat.sendMessage.mockReturnValueOnce(new Promise<void>((resolve) => { settle = resolve; }));
    const { getByRole, getByLabelText } = renderScreen(<SupportComposerScreen />);
    const send = getByRole('button', { name: 'donations.timeScreen.sendButton' });
    expect(send.getAttribute('aria-disabled')).toBe('true');

    fireEvent.change(getByLabelText('donations.timeScreen.composerHeading'), { target: { value: 'I can help' } });
    fireEvent.click(send);
    await vi.waitFor(() => expect(send.getAttribute('aria-busy')).toBe('true'));
    await act(async () => settle());
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith({ pathname: '/chat/[id]', params: { id: 'c_1' } }));
  });
});
