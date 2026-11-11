import '../src/lib/polyfills';
import { startMark, finishMark } from '../src/lib/observability/perfMarks';
startMark('app.cold_start');
import { initSentry } from '../src/lib/observability/sentry';
import { initPosthog } from '../src/lib/observability/posthog';
import { installGlobalErrorHandlers } from '../src/lib/observability/globalErrorHandlers';
import { useUncaughtErrorStore } from '../src/store/uncaughtErrorStore';
// KC#1410: the global handlers wrap Sentry's, so they install once init settled.
void initSentry().then(() =>
  installGlobalErrorHandlers((error) => useUncaughtErrorStore.getState().show(error)),
);
void initPosthog();
import i18n from '../src/i18n';
import React, { useEffect } from 'react';
import { RevenueCatSync } from '../src/services/purchases/RevenueCatSync';
import { Stack } from 'expo-router';
import { I18nManager, Platform } from 'react-native';
import {
  isRtlLanguage,
  applyLayoutDirection,
  loadStoredLanguageAsync,
  reloadApp,
  type AppLanguage,
} from '../src/i18n/language';
import '../src/lib/webDocumentBootstrap';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { queryClient, persistOptions, setupQueryLifecycleSync } from '../src/lib/queryPersist';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { BrandFontProvider, useTheme } from '@kc/ui';
import { ShellWithResponsiveChrome } from '../src/components/shell/ShellWithResponsiveChrome';
import { AppThemeProvider } from '../src/components/AppThemeProvider';
import { NotificationsBridge } from '../src/components/NotificationsBridge';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
export { RouteErrorBoundary as ErrorBoundary } from '../src/components/RouteErrorBoundary';
import { UncaughtErrorGate } from '../src/components/UncaughtErrorGate';
import { SoftGateProvider } from '../src/components/OnboardingSoftGate';
import { AuthGate } from '../src/components/AuthGate';
import { useDetailStackScreenOptions } from '../src/navigation/detailStackScreenOptions';
import { rootStackGestureEnabled, rootStackScreenAnimation } from '../src/navigation/rootStackAnimation';
import { ConfigErrorScreen } from '../src/components/ConfigErrorScreen';
import { isSupabaseConfigured } from '../src/lib/supabasePublicConfig';
import { DevBanner } from '../src/components/DevBanner';
import { SuspensionBanner } from '../src/components/SuspensionBanner';
import { LegalConsentGate } from '../src/components/legal/LegalConsentGate';
import { ModalStackProvider } from '../src/components/legal/useActiveModalStack';
import { useBrandFonts } from '../src/lib/useBrandFonts';
import { useOnlinePresenceLifecycle } from '../src/hooks/useOnlinePresence';
import { useCoreLoopReturnVisit } from '../src/hooks/useCoreLoopReturnVisit';
import { useRecordActiveDay } from '../src/hooks/useRecordActiveDay';
import * as NavigationBar from 'expo-navigation-bar';

function SignedInLifecycleMount() {
  useOnlinePresenceLifecycle();
  useCoreLoopReturnVisit();
  useRecordActiveDay();
  return null;
}

void SplashScreen.preventAutoHideAsync();


// Inner wiring lives after AppThemeProvider so screen options that depend on
// the active palette (web html bg, surface backgrounds in screen headers,
// StatusBar style) read fresh values when the user toggles dark mode.
function ThemedRootShell() {
  React.useEffect(() => { finishMark('app.cold_start'); }, []);
  const { colors, isDark } = useTheme();
  const detailStackScreenOptions = useDetailStackScreenOptions();

  React.useEffect(() => {
    // expo-navigation-bar on SDK 54 is imperative and Android-only (KC#1276).
    if (Platform.OS !== 'android') return;
    // Edge-to-edge (targetSdk 36) can reject this on some devices; a thrown
    // call here is an uncaught startup error, so the shell must survive it.
    try {
      void Promise.resolve(NavigationBar.setStyle(isDark ? 'dark' : 'light')).catch(() => undefined);
    } catch {
      /* navigation bar contrast is cosmetic */
    }
  }, [isDark]);

  React.useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      // Paint html/body with the active surface so the area outside the app
      // root (and any iOS overscroll bounce on mobile-web) matches the theme.
      document.documentElement.style.backgroundColor = colors.background;
      if (document.body) document.body.style.backgroundColor = colors.background;
    }
  }, [colors.background]);

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <DevBanner />
      <SuspensionBanner />
      <NotificationsBridge />
      <AuthGate>
        <ModalStackProvider>
          <LegalConsentGate>
            <SoftGateProvider>
              <ShellWithResponsiveChrome>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.background },
                // Subtle cross-fade across every platform so screen
                // changes feel like part of the same surface, not a
                // hard hand-off. 220 ms matches the welcome-screen
                // hero entry, giving the whole app one motion vocab.
                animation: rootStackScreenAnimation(),
                animationDuration: Platform.OS === 'web' ? 220 : undefined,
                gestureEnabled: rootStackGestureEnabled,
                fullScreenGestureEnabled: Platform.OS === 'ios',
              }}
            >
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="(guest)" />
              <Stack.Screen name="(onboarding)" />
              <Stack.Screen name="(tabs)" />
              {/* FR-POST-001 AC9 — the create form slides up over the screen it was opened from. */}
              <Stack.Screen
                name="create"
                options={{ animation: Platform.OS === 'web' ? 'fade' : 'slide_from_bottom' }}
              />
              {/* FR-ADMIN-011 AC1 — register the admin group at the root so
                  native stack navigation can resolve `/(admin)` targets.
                  Without this, `router.push('/(admin)')` is a no-op on iOS /
                  Android (web URL routing falls back to resolved path). */}
              <Stack.Screen name="(admin)" />
              <Stack.Screen name="auth/callback" />
              <Stack.Screen name="auth/verify" />
              {/* FR-MOD-010 AC4 — terminal screen for blocked accounts. */}
              <Stack.Screen name="account-blocked" options={{ headerShown: true, headerTitle: '', headerBackVisible: false, headerStyle: { backgroundColor: colors.surface } }} />
              <Stack.Screen name="settings" />
              <Stack.Screen
                name="notifications/inbox"
                options={{ ...detailStackScreenOptions, headerTitle: i18n.t('notifications.inboxTitle') }}
              />
              <Stack.Screen name="matches" options={{ ...detailStackScreenOptions, headerTitle: i18n.t('matches.title') }} />
              <Stack.Screen name="about" options={{ headerShown: false }} />
              <Stack.Screen name="about-site" options={{ headerShown: false }} />
              {/* FR-RESEARCH-001 — public web survey; no auth shell */}
              <Stack.Screen name="research" options={{ headerShown: false }} />
              <Stack.Screen name="edit-profile" options={{ ...detailStackScreenOptions, headerTitle: i18n.t('settings.editProfileTitle') }} />
              <Stack.Screen
                name="identity-verification"
                options={{ ...detailStackScreenOptions, headerTitle: i18n.t('verification.identity.title') }}
              />
              <Stack.Screen name="post/[id]" options={{ ...detailStackScreenOptions, headerTitle: i18n.t('post.detailTitle') }} />
              <Stack.Screen name="listing/[listingId]" options={{ ...detailStackScreenOptions, headerTitle: '' }} />
              {/* user/[handle]/* owns its own header via the nested _layout */}
              <Stack.Screen name="user/[handle]" options={{ headerShown: false }} />
              {/* In-screen `ChatConversationHeader` owns the top bar; a native-stack header
                  must stay off so it never sits above the custom bar on web/mobile (taps). */}
              <Stack.Screen name="chat/[id]" options={{ headerShown: false }} />
              {/* chat/index renders its own header inside the screen — disable the Stack one to avoid doubling. */}
              <Stack.Screen name="chat/index" options={{ headerShown: true }} />
              {/* FR-CHAT-017 — recipient picker; the screen sets its own header options. */}
              <Stack.Screen name="chat/new" options={{ headerShown: true }} />
            </Stack>
              </ShellWithResponsiveChrome>
            </SoftGateProvider>
          </LegalConsentGate>
        </ModalStackProvider>
      </AuthGate>
    </>
  );
}

function RootLayoutContent() {
  useEffect(() => {
    return setupQueryLifecycleSync();
  }, []);

  useEffect(() => {
    // FR-SETTINGS-018: keep layout direction aligned with the active UI language.
    // Web resolved its direction at module load from localStorage; here we align
    // I18nManager. Native reconciles the async-persisted preference and reloads
    // once if the reading direction has to flip (RN bakes RTL at load time).
    if (Platform.OS === 'web') {
      applyLayoutDirection(i18n.language === 'en' ? 'en' : 'he');
      return;
    }
    let cancelled = false;
    void (async () => {
      const stored = await loadStoredLanguageAsync();
      if (cancelled) return;
      const desired: AppLanguage = stored ?? (i18n.language === 'en' ? 'en' : 'he');
      const needsReload = I18nManager.isRTL !== isRtlLanguage(desired);
      if (desired !== i18n.language) await i18n.changeLanguage(desired);
      applyLayoutDirection(desired);
      if (needsReload) reloadApp();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, width: '100%', alignSelf: 'stretch' }}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
            <SignedInLifecycleMount />
            <RevenueCatSync />
            <AppThemeProvider>
              {/* KC#1410: a fatal uncaught JS error shows the themed fallback;
                  retry remounts the shell instead of the OS killing the app. */}
              <UncaughtErrorGate>
                <ThemedRootShell />
              </UncaughtErrorGate>
            </AppThemeProvider>
          </PersistQueryClientProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default function RootLayout() {
  // Splash stays up (preventAutoHideAsync) until the brand font settles.
  const brandFontStatus = useBrandFonts();
  if (brandFontStatus === 'loading') return null;
  return (
    <BrandFontProvider available={brandFontStatus === 'loaded'}>
      {isSupabaseConfigured() ? (
        <RootLayoutContent />
      ) : (
        <GestureHandlerRootView style={{ flex: 1 }}>
          <SafeAreaProvider>
            <ConfigErrorScreen />
          </SafeAreaProvider>
        </GestureHandlerRootView>
      )}
    </BrandFontProvider>
  );
}
