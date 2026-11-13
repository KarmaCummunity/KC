// AuthGate — cold-start session restore + onboarding-state read + redirect
// rules between (auth) / (guest) / (onboarding) / (tabs).
// Mapped to SRS: FR-AUTH-007 AC2, FR-AUTH-013 (cold-start), FR-AUTH-014 (guest),
// FR-AUTH-010 AC3 (Skip preserves location).
// FR-CHAT-001: inbox subscription started on sign-in, torn down on sign-out.
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, View } from 'react-native';
import { spacing, typography, useTheme, Text } from '@kc/ui';
import { useTranslation } from 'react-i18next';
import { useRouter, useSegments, usePathname, type Href } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useQueryClient } from '@tanstack/react-query';
import { subscribeToSession } from '../services/authComposition';
import { restoreSessionReporting } from '../services/restoreSessionReporting';
import { tryDevAutoSignIn } from '../services/devAutoSignIn';
import { startColdStartSession } from '../services/coldStartSession';
import { getDevGhostSession, isDevGhostSessionEnabled } from '../services/devGhostSession';
import { getOnboardingBootstrap, getReconcileAuthProfileMetadataUseCase } from '../services/userComposition';
import { useAuthStore } from '../store/authStore';
import { useChatStore } from '../store/chatStore';
import { usePostDraftStore } from '../store/postDraftStore';
import { useRedirectIntentStore } from '../store/redirectIntentStore';
import { container } from '../lib/container';
import { useEnforceAccountGate } from '../hooks/useEnforceAccountGate';
import { finishMark } from '../lib/observability/perfMarks';
import { isPublicResearchPath } from '../navigation/publicResearchPaths';
import { isPublicLegalSegment } from '../navigation/publicLegalPaths';
import { isPublicOrgPagePath } from '../navigation/publicOrgPaths';
import { PrimaryButton } from './ui/Buttons';

export function AuthGate({ children }: Readonly<{ children: React.ReactNode }>) {
  const { colors } = useTheme();
  const router = useRouter();
  const segments: string[] = useSegments();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const capturePendingPath = useRedirectIntentStore((s) => s.capturePath);
  const consumePendingPath = useRedirectIntentStore((s) => s.consumePath);
  const session = useAuthStore((s) => s.session);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const onboardingState = useAuthStore((s) => s.onboardingState);
  const basicInfoSkipped = useAuthStore((s) => s.basicInfoSkipped);
  const setSession = useAuthStore((s) => s.setSession);
  const setOnboardingState = useAuthStore((s) => s.setOnboardingState);
  const setBasicInfoSkipped = useAuthStore((s) => s.setBasicInfoSkipped);
  const [onboardingBootstrapError, setOnboardingBootstrapError] = useState(false);
  const { t } = useTranslation();

  // FR-MOD-010 AC4 — sign-in + mid-session enforcement of bans / suspensions.
  useEnforceAccountGate(session?.userId ?? null);

  // FR-AUTH-013: cold-start session restore.
  // Dev-only fallbacks (compiled out of production bundles by `__DEV__`):
  //   1. Ghost session — fake JWT, instant, layout-only (devGhostSession.ts)
  //   2. Auto sign-in — real Supabase auth with test credentials (devAutoSignIn.ts)
  // Ghost takes priority because it's instant and has no network dependency.
  useEffect(() => {
    // Ghost mode short-circuits the restore flow entirely — no Supabase call,
    // no subscription needed (the fake session never changes).
    const ghost = getDevGhostSession();
    if (ghost) {
      setSession(ghost);
      return undefined;
    }

    // Restore + subscription race handling lives in coldStartSession (TD-127).
    return startColdStartSession({
      restore: restoreSessionReporting,
      subscribe: subscribeToSession,
      devFallback: tryDevAutoSignIn,
      setSession,
    });
  }, [setSession]);

  useEffect(() => {
    if (isLoading) return;
    void SplashScreen.hideAsync();
    // Cold start ends when the splash is hidden: that is when the member first sees the app.
    finishMark('app.cold_start');
  }, [isLoading]);

  // FR-AUTH-007 AC2: read users.onboarding_state once we know the user.
  // Ghost mode skips the Supabase read (it would 401) and assumes 'completed'
  // so AuthGate redirects straight to /(tabs).
  useEffect(() => {
    if (!isAuthenticated || !session) return;
    if (isDevGhostSessionEnabled()) {
      setOnboardingState('completed');
      setBasicInfoSkipped(false);
      return;
    }
    let cancelled = false;
    setOnboardingBootstrapError(false);
    void (async () => {
      try {
        const boot = await getOnboardingBootstrap(session.userId);
        if (!cancelled) {
          setOnboardingState(boot.state);
          setBasicInfoSkipped(boot.basicInfoSkipped);
          setOnboardingBootstrapError(false);
        }
      } catch {
        if (!cancelled) {
          setOnboardingBootstrapError(true);
          setOnboardingState(null);
          setBasicInfoSkipped(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, session, setOnboardingState, setBasicInfoSkipped]);

  // FR-CHAT-001: start inbox subscription on sign-in; tear it down on sign-out.
  // This effect mirrors the session effect above — it runs whenever `session`
  // changes so the subscription lifecycle is always in sync with auth state.
  // Ghost mode skips realtime entirely (the fake JWT would be rejected and
  // generate noisy WS reconnect loops).
  //
  // Audit 2026-05-10 §17.6 — also clear the React Query cache on sign-out so a
  // follow-up sign-in on the same device doesn't see the previous user's
  // cached posts/profile/feed in the first frame. Sign-in path doesn't clear:
  // a returning user's own cached data is still valid.
  useEffect(() => {
    if (isDevGhostSessionEnabled()) return;
    if (session?.userId) {
      void useChatStore.getState().startInboxSub(session.userId, container.chatRepo, container.chatRealtime);
    } else {
      useChatStore.getState().resetOnSignOut();
      queryClient.clear();
      // FR-POST-007 AC5 — drop the local post draft so a different user
      // signing in on the same device does not see the previous user's draft.
      usePostDraftStore.getState().clearDraft();
    }
  }, [session, queryClient]);

  // FR-AUTH-003 AC5 / FR-PROFILE-001: heal JWT user_metadata drift after cold start
  // so My Profile does not flash stale OAuth names before the profile query returns.
  useEffect(() => {
    if (!session?.userId || isDevGhostSessionEnabled()) return;
    let cancelled = false;
    void (async () => {
      try {
        await getReconcileAuthProfileMetadataUseCase().execute({ userId: session.userId });
      } catch {
        // Non-fatal — profile screen still reads from DB; user can retry via edit-profile save.
      }
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.userId]);

  // Redirect rules:
  //   - Unauth + outside (auth)/(guest)/auth/callback/auth/verify → (auth).
  //   - Auth + just landed in (auth) or (guest) → onboarding step matching
  //     onboarding_state, or (tabs) when completed.
  //   - Auth + already past the gates → no auto-redirect (FR-AUTH-015 soft-gate
  //     handles pending_basic_info on first meaningful action; auto-redirecting
  //     from tabs back to onboarding would loop after the FR-AUTH-010 AC3 Skip).
  useEffect(() => {
    if (isLoading) return;
    const inAuthGroup = segments[0] === '(auth)';
    const inGuestGroup = (segments[0] as string | undefined) === '(guest)';
    const isOAuthCallback =
      (segments[0] as string | undefined) === 'auth' && segments[1] === 'callback';
    // FR-AUTH-006 — email verification landing route is reachable while signed
    // out; the route itself exchanges the token and sets the session.
    const isEmailVerify =
      (segments[0] as string | undefined) === 'auth' && segments[1] === 'verify';
    // FR-AUTH-008 — reset-password opens from an email link while signed out and
    // must not be redirected once the recovery token creates a session.
    const isPasswordReset =
      (segments[0] as string | undefined) === 'auth' && segments[1] === 'reset-password';
    // FR-MOD-010 AC4 — account-blocked is a terminal screen reachable while
    // signed out; do not bounce the user back to (auth).
    const isAccountBlocked = (segments[0] as string | undefined) === 'account-blocked';
    const isAboutSurface =
      (segments[0] as string | undefined) === 'about' ||
      (segments[0] as string | undefined) === 'about-site';
    // FR-RESEARCH-001 AC2 / FR-RESEARCH-004 AC7 — public survey is web-only and
    // must stay reachable from shared links without sign-in.
    const isResearchSurface =
      (segments[0] as string | undefined) === 'research' ||
      (typeof pathname === 'string' && isPublicResearchPath(pathname));
    // Terms / privacy must be readable before sign-up (store review, D-47).
    const isLegalSurface = isPublicLegalSegment(segments as readonly string[]);
    // FR-ORG-001 AC4 — a nonprofit's public page opens from a shared link without sign-in.
    const isPublicOrgSurface = typeof pathname === 'string' && isPublicOrgPagePath(pathname);

    if (!isAuthenticated) {
      if (
        !inAuthGroup &&
        !inGuestGroup &&
        !isOAuthCallback &&
        !isEmailVerify &&
        !isPasswordReset &&
        !isAccountBlocked &&
        !isAboutSurface &&
        !isResearchSurface &&
        !isLegalSurface &&
        !isPublicOrgSurface
      ) {
        // FR-POST-023 AC6 — remember the deep-link target so we can restore
        // it after the user completes sign-in / onboarding.
        if (typeof pathname === 'string') capturePendingPath(pathname);
        router.replace('/(auth)');
      }
      return;
    }

    if (!inAuthGroup && !inGuestGroup && !isOAuthCallback && !isEmailVerify) return;
    if (onboardingState === null) return;

    if (onboardingState === 'pending_basic_info' && basicInfoSkipped === true) {
      // FR-POST-023 AC6 — restore a captured deep-link if the user signed in
      // straight through the basic-info skip path.
      const pending = consumePendingPath();
      router.replace((pending ?? '/(tabs)') as Href);
    } else if (onboardingState === 'pending_basic_info') {
      router.replace('/(onboarding)/about-intro');
    } else if (onboardingState === 'pending_avatar') {
      router.replace('/(onboarding)/photo');
    } else {
      const pending = consumePendingPath();
      router.replace((pending ?? '/(tabs)') as Href);
    }
  }, [isLoading, isAuthenticated, onboardingState, basicInfoSkipped, segments, pathname, router, capturePendingPath, consumePendingPath]);

  if (isLoading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          justifyContent: 'center',
          alignItems: 'center',
          gap: spacing.xl,
        }}
      >
        <Image
          source={require('../../assets/logo.png')}
          style={{ width: 96, height: 96 }}
          resizeMode="contain"
        />
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (isAuthenticated && onboardingBootstrapError) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          justifyContent: 'center',
          padding: spacing.lg,
        }}
      >
        <Text style={{ ...typography.body, color: colors.textPrimary, textAlign: 'center' }}>
          {t('general.error')}
        </Text>
        <View style={{ marginTop: spacing.md }}>
          <PrimaryButton
            testID="auth-gate-retry"
            label={t('general.retry')}
            size="md"
            onPress={() => {
              if (!session) return;
              setOnboardingBootstrapError(false);
              void getOnboardingBootstrap(session.userId)
                .then((boot) => {
                  setOnboardingState(boot.state);
                  setBasicInfoSkipped(boot.basicInfoSkipped);
                })
                .catch(() => setOnboardingBootstrapError(true));
            }}
          />
        </View>
      </View>
    );
  }

  return <>{children}</>;
}
