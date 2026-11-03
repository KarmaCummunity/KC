// @vitest-environment jsdom
// Informational dialogs on the kit `Modal` (spec 17 §4.1.1, TD-243): each
// renders as a named dialog, runs its main action and dismisses.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { Linking } from 'react-native';

const { closure, findUserById, routerPush } = vi.hoisted(() => ({
  closure: {
    step: 'explainer',
    postType: 'Give',
    dismissExplainer: vi.fn(),
    completeWithoutExplainer: vi.fn(),
  },
  findUserById: vi.fn(async () => ({ closureExplainerDismissed: false })),
  routerPush: vi.fn(),
}));

vi.mock('react-native-reanimated', async () => (await import('../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('react-native-safe-area-context', async () => (await import('../ui/__tests__/kitDialogTestKit')).safeAreaDouble);
vi.mock('react-i18next', async () => (await import('../ui/__tests__/kitDialogTestKit')).i18nDouble);
vi.mock('@expo/vector-icons', async () => (await import('../ui/__tests__/kitDialogTestKit')).iconsDouble);
vi.mock('../../hooks/useReducedMotion', () => ({ useReducedMotion: () => false }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: routerPush }) }));
vi.mock('../../store/closureStore', () => ({
  useClosureStore: (select: (state: typeof closure) => unknown) => select(closure),
}));
vi.mock('../../store/authStore', () => ({
  useAuthStore: (select: (state: { session: { userId: string } }) => unknown) => select({ session: { userId: 'u-1' } }),
}));
vi.mock('../../services/userComposition', () => ({ getUserRepo: () => ({ findById: findUserById }) }));

import { finishModalAnimation, renderInTheme } from '../ui/__tests__/kitDialogTestKit';
import { NotifyModal } from '../NotifyModal';
import { EnablePushModal } from '../EnablePushModal';
import { SurveyThankYouModal } from '../survey/SurveyThankYouModal';
import { KarmaBadge } from '../profile/KarmaBadge';
import { ClosureExplainerSheet } from '../closure/ClosureExplainerSheet';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('NotifyModal', () => {
  it('shows the message and dismisses from its single action', () => {
    const onDismiss = vi.fn();
    renderInTheme(<NotifyModal visible title="Saved" message="Your changes were saved." onDismiss={onDismiss} />);
    expect(screen.getByRole('dialog', { name: 'Saved' })).toBeTruthy();
    expect(screen.getByText('Your changes were saved.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'general.gotIt' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('EnablePushModal', () => {
  it('accepts, or declines from the ghost action and from Escape', () => {
    const onAccept = vi.fn();
    const onDecline = vi.fn();
    renderInTheme(<EnablePushModal visible trigger="first-post-published" onAccept={onAccept} onDecline={onDecline} />);
    expect(screen.getByRole('dialog', { name: 'notifications.enablePushTitle' })).toBeTruthy();
    expect(screen.getByText('notifications.enablePushBodyFromPost')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'notifications.enablePushAccept' }));
    fireEvent.click(screen.getByRole('button', { name: 'notifications.enablePushDecline' }));
    fireEvent.keyUp(document, { key: 'Escape' });
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onDecline).toHaveBeenCalledTimes(2);
  });

  it('offers the OS settings when the OS will not prompt again', () => {
    // React Native Web's Linking has no `openSettings`; stand one in.
    const openSettings = vi.fn(() => Promise.resolve());
    Object.assign(Linking, { openSettings });
    renderInTheme(
      <EnablePushModal visible trigger={null} showOpenSettings onAccept={vi.fn()} onDecline={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'notifications.openOsSettings' }));
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'notifications.enablePushAccept' })).toBeNull();
  });
});

describe('SurveyThankYouModal', () => {
  it('shares and dismisses after a public research survey', () => {
    const onShare = vi.fn();
    const onDismiss = vi.fn();
    renderInTheme(<SurveyThankYouModal visible variant="publicResearch" onShare={onShare} onDismiss={onDismiss} />);
    expect(screen.getByRole('dialog', { name: 'research.thankYouModal.title' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'research.share.endSurveyCta' }));
    fireEvent.click(screen.getByRole('button', { name: 'research.thankYouModal.dismiss' }));
    expect(onShare).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('offers only the dismiss action in the app', () => {
    const onDismiss = vi.fn();
    renderInTheme(<SurveyThankYouModal visible variant="inApp" onDismiss={onDismiss} />);
    expect(screen.queryByRole('button', { name: 'research.share.endSurveyCta' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'survey.thankYouModal.dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('KarmaBadge', () => {
  it('opens the "how to earn" dialog from the info control and closes it', () => {
    renderInTheme(<KarmaBadge points={42} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'karma.howToEarnTitle' }));
    finishModalAnimation();
    expect(screen.getByRole('dialog', { name: 'karma.howToEarnTitle' })).toBeTruthy();
    expect(screen.getByText('• karma.earnClosure')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'karma.close' }));
    finishModalAnimation();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(routerPush).not.toHaveBeenCalled();
  });
});

describe('ClosureExplainerSheet', () => {
  async function renderExplainer() {
    renderInTheme(<ClosureExplainerSheet />);
    await screen.findByText('closure.explainerGiveTitle');
    finishModalAnimation();
  }

  it('persists "don\'t show again" when the user ticks it and confirms', async () => {
    await renderExplainer();
    expect(screen.getByRole('dialog', { name: 'closure.explainerGiveTitle' })).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'general.gotIt' }));
    expect(closure.dismissExplainer).toHaveBeenCalledWith(true, 'u-1');
  });

  it('treats a dismissal as "got it" without persisting', async () => {
    await renderExplainer();
    fireEvent.click(screen.getByRole('button', { name: 'general.close' }));
    expect(closure.completeWithoutExplainer).toHaveBeenCalledTimes(1);
    expect(closure.dismissExplainer).not.toHaveBeenCalled();
  });
});
