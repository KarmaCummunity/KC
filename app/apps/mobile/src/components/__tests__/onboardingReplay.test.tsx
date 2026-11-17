// @vitest-environment jsdom
// FR-ADMIN-035 — onboarding replay for admins: the dashboard card starts a sandboxed replay, the
// banner offers the way out on every step, and the tour ends back in the admin portal.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent } from '@testing-library/react';

const router = { back: vi.fn(), push: vi.fn(), replace: vi.fn() };

vi.mock('react-native-reanimated', async () => (await import('../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('@expo/vector-icons', async () => (await import('../ui/__tests__/kitDialogTestKit')).iconsDouble);
vi.mock('react-i18next', async () => (await import('../ui/__tests__/kitDialogTestKit')).i18nDouble);
vi.mock('react-native-safe-area-context', async () => (await import('../ui/__tests__/kitDialogTestKit')).safeAreaDouble);
vi.mock('../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('expo-router', () => ({ useRouter: () => router }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: undefined }) }));
// The dashboard's data sources and chrome are not under test.
vi.mock('../animations/TourSlidePager', () => ({ TourSlidePager: () => null }));
vi.mock('../OnboardingStepHeader', () => ({ OnboardingStepHeader: () => null }));
vi.mock('../../hooks/useAdminRoles', () => ({ useAdminRoles: () => ({ roles: ['moderator'], isLoading: false }) }));
vi.mock('../../hooks/useAdminsList', () => ({ useAdminsList: () => ({ grants: [], isLoading: false }) }));
vi.mock('../../hooks/useAdminTasks', () => ({ useAdminOpenTaskCount: () => ({ count: null }) }));
vi.mock('../../hooks/useReportsInbox', () => ({ useReportsInbox: () => ({ data: undefined }) }));
vi.mock('../../hooks/useLaunchSurface', () => ({ useLaunchSurface: () => false }));
vi.mock('../../services/postsComposition', () => ({ getCommunityStatsSnapshotUseCase: () => ({ execute: vi.fn() }) }));
vi.mock('../admin/AdminPortalChrome', () => ({ useAdminPortalChrome: () => undefined }));
vi.mock('../admin/AdminDashboardSearch', () => ({ AdminDashboardSearch: () => null }));
// Every dashboard string reads as its key, so the test names the card without loading a locale bundle.
vi.mock('../../i18n/useLocaleBundle', () => {
  const dashboard = new Proxy({}, { get: (_target, key) => `dashboard.${String(key)}` });
  return { useLocaleBundle: () => ({ admin: { roles: {}, portalTitle: 'portal', dashboard } }) };
});

import AdminDashboard from '../../../app/(admin)/index';
import TourScreen from '../../../app/(onboarding)/tour';
import { OnboardingReplayBanner } from '../onboarding/OnboardingReplayBanner';
import { useOnboardingReplayStore } from '../../store/onboardingReplayStore';
import { renderInTheme } from '../ui/__tests__/kitDialogTestKit';

const replay = () => useOnboardingReplayStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  replay().stop();
});
afterEach(cleanup);

describe('admin dashboard — replay onboarding card', () => {
  it('starts a replay and opens the first onboarding step, every time it is tapped', () => {
    const { getByRole } = renderInTheme(<AdminDashboard />);
    const card = getByRole('button', { name: 'dashboard.onboardingReplayKpi' });

    fireEvent.click(card);
    expect(replay().active).toBe(true);
    expect(router.push).toHaveBeenLastCalledWith('/(onboarding)/about-intro');

    // A second run starts clean even when the first left a preview photo behind.
    replay().setAvatarPreview('file://first.jpg');
    fireEvent.click(card);
    expect(replay()).toMatchObject({ active: true, avatarPreviewUri: null });
    expect(router.push).toHaveBeenCalledTimes(2);
  });
});

describe('OnboardingReplayBanner', () => {
  it('renders nothing during a real onboarding', () => {
    const { queryByTestId } = renderInTheme(<OnboardingReplayBanner />);
    expect(queryByTestId('onboarding-replay-banner')).toBeNull();
  });

  it('names the preview mode and exits to the admin portal in one tap', () => {
    replay().start();
    const { getByText, getByRole } = renderInTheme(<OnboardingReplayBanner />);
    expect(getByText('onboardingReplay.bannerTitle')).toBeTruthy();
    fireEvent.click(getByRole('button', { name: 'onboardingReplay.exitCta' }));
    expect(replay().active).toBe(false);
    expect(router.replace).toHaveBeenCalledWith('/(admin)');
  });
});

describe('tour — where the onboarding ends', () => {
  /** Walks the three slides to the final call to action and presses it. */
  function finishTour() {
    const { getByRole } = renderInTheme(<TourScreen />);
    fireEvent.click(getByRole('button', { name: 'onboarding.tourNextCta' }));
    fireEvent.click(getByRole('button', { name: 'onboarding.tourNextCta' }));
    fireEvent.click(getByRole('button', { name: 'onboarding.tourLetsStartCta' }));
  }

  it('returns an admin replay to the admin portal', () => {
    replay().start();
    finishTour();
    expect(router.replace).toHaveBeenCalledWith('/(admin)');
  });

  it('still opens the app after a real onboarding', () => {
    finishTour();
    expect(router.replace).toHaveBeenCalledWith('/(tabs)');
  });
});
