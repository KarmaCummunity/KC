// Splash + Welcome / Auth-method picker.
// Mapped to SRS: FR-AUTH-001 (splash), FR-AUTH-002 (auth entry, all methods),
// FR-AUTH-014 (guest preview entry point).
// docs/spec/requirements/01_auth_and_onboarding.md
import React, { useEffect, useState } from 'react';
import { View, TouchableOpacity, Platform, ScrollView, Image, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withDelay,
  withRepeat,
  withSequence,
} from 'react-native-reanimated';
import { useTheme, Text, iconSize } from '@kc/ui';
import { isAuthError } from '@kc/application';
import { useAuthStore } from '../../src/store/authStore';
import {
  getOAuthRedirectUri,
  getSignInWithGoogleUseCase,
  getSignInWithAppleUseCase,
  redirectToGoogleSignInWeb,
} from '../../src/services/authComposition';
import { mapAuthErrorToHebrew } from '../../src/services/authMessages';
import { NotifyModal } from '../../src/components/NotifyModal';
import { AmbientBlobs } from '../../src/components/ui/AmbientBlobs';
import { AuthMiniAboutTeaser } from '../../src/components/auth/AuthMiniAboutTeaser';
import { useWelcomeScreenStyles } from '../../src/components/auth/welcomeScreen.styles';

export { RouteErrorBoundary as ErrorBoundary } from '../../src/components/RouteErrorBoundary';

const VALUE_PROPS: Array<{ icon: React.ComponentProps<typeof Ionicons>['name']; key: string }> = [
  { icon: 'gift-outline', key: 'welcomeValueProp1' },
  { icon: 'search-outline', key: 'welcomeValueProp2' },
  { icon: 'chatbubbles-outline', key: 'welcomeValueProp3' },
];

export default function WelcomeScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const styles = useWelcomeScreenStyles();
  const { colors } = useTheme();
  const setGuest = useAuthStore((s) => s.setGuest);
  const setSession = useAuthStore((s) => s.setSession);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [appleLoading, setAppleLoading] = useState(false);
  const [appleError, setAppleError] = useState<string | null>(null);
  const isExecutingRef = React.useRef(false);

  // ── Animation values ──────────────────────────────────────────────────
  const heroOpacity = useSharedValue(0);
  const heroTranslateY = useSharedValue(28);
  const propsOpacity = useSharedValue(0);
  const propsTranslateX = useSharedValue(24);
  const buttonsOpacity = useSharedValue(0);
  const buttonsTranslateY = useSharedValue(24);
  const ringScale = useSharedValue(1);
  const ringOpacity = useSharedValue(0.4);

  useEffect(() => {
    heroOpacity.value = withTiming(1, { duration: 500 });
    heroTranslateY.value = withSpring(0, { damping: 18, stiffness: 90 });

    propsOpacity.value = withDelay(300, withTiming(1, { duration: 450 }));
    propsTranslateX.value = withDelay(300, withSpring(0, { damping: 20, stiffness: 100 }));

    buttonsOpacity.value = withDelay(520, withTiming(1, { duration: 400 }));
    buttonsTranslateY.value = withDelay(520, withSpring(0, { damping: 18 }));

    ringScale.value = withDelay(
      600,
      withRepeat(
        withSequence(withTiming(1.18, { duration: 1600 }), withTiming(1, { duration: 1600 })),
        -1,
        false,
      ),
    );
    ringOpacity.value = withDelay(
      600,
      withRepeat(
        withSequence(withTiming(0.1, { duration: 1600 }), withTiming(0.45, { duration: 1600 })),
        -1,
        false,
      ),
    );
  }, [buttonsOpacity, buttonsTranslateY, heroOpacity, heroTranslateY, propsOpacity, propsTranslateX, ringOpacity, ringScale]);

  const heroStyle = useAnimatedStyle(() => ({
    opacity: heroOpacity.value,
    transform: [{ translateY: heroTranslateY.value }],
  }));
  const propsStyle = useAnimatedStyle(() => ({
    opacity: propsOpacity.value,
    transform: [{ translateX: propsTranslateX.value }],
  }));
  const buttonsStyle = useAnimatedStyle(() => ({
    opacity: buttonsOpacity.value,
    transform: [{ translateY: buttonsTranslateY.value }],
  }));
  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: ringScale.value }],
    opacity: ringOpacity.value,
  }));

  const handleGoogle = async () => {
    if (isExecutingRef.current) return;
    isExecutingRef.current = true;
    setGoogleLoading(true);
    try {
      // FR-AUTH-002 web fix: same-tab redirect to accounts.google.com.
      // Safari blocks the `window.open` popup that `WebBrowser` used on web;
      // a top-level navigation has no such restriction. The JS context here
      // is destroyed by the navigation, so the use case path below only
      // runs on native (iOS ASWebAuth / Android Chrome Custom Tabs).
      if (Platform.OS === 'web') {
        await redirectToGoogleSignInWeb();
        return;
      }
      const { session } = await getSignInWithGoogleUseCase().execute({ redirectTo: getOAuthRedirectUri() });
      setSession(session);
      router.replace('/(tabs)');
    } catch (err) {
      const code = isAuthError(err) ? err.code : 'unknown';
      const message =
        isAuthError(err) && err.message === 'oauth_dismissed'
          ? null
          : isAuthError(err)
            ? mapAuthErrorToHebrew(code)
            : t('auth.networkError');
      if (message && !useAuthStore.getState().isAuthenticated) {
        setGoogleError(`${message} (${isAuthError(err) ? err.message : String(err)})`);
      }
    } finally {
      setGoogleLoading(false);
      isExecutingRef.current = false;
    }
  };

  // FR-AUTH-004 (iOS only): native Sign in with Apple. A deliberate cancel
  // (`apple_dismissed`) is silent; real failures surface in the modal.
  const handleApple = async () => {
    if (isExecutingRef.current) return;
    isExecutingRef.current = true;
    setAppleLoading(true);
    try {
      const { session } = await getSignInWithAppleUseCase().execute();
      setSession(session);
      router.replace('/(tabs)');
    } catch (err) {
      const dismissed = isAuthError(err) && err.message === 'apple_dismissed';
      if (!dismissed && !useAuthStore.getState().isAuthenticated) {
        const message = isAuthError(err) ? mapAuthErrorToHebrew(err.code) : t('auth.networkError');
        setAppleError(`${message} (${isAuthError(err) ? err.message : String(err)})`);
      }
    } finally {
      setAppleLoading(false);
      isExecutingRef.current = false;
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <AmbientBlobs density="auth" />
      <ScrollView contentContainerStyle={styles.scroll} bounces={false}>

        {/* Hero */}
        <Animated.View style={[styles.hero, heroStyle]}>
          <View style={styles.logoRingWrapper}>
            <Animated.View style={[styles.logoRing, ringStyle]} />
            <Image source={require('../../assets/logo.png')} style={styles.logo} resizeMode="contain" />
          </View>
          <Text style={styles.appName}>{t('auth.welcomeAppName')}</Text>
          <Text style={styles.tagline}>{t('auth.tagline')}</Text>
        </Animated.View>

        {/* Value props */}
        <Animated.View style={[styles.valueProps, propsStyle]}>
          {VALUE_PROPS.map(({ icon, key }) => (
            <View key={key} style={styles.valuePropRow}>
              <Text style={styles.valuePropText}>{t(`auth.${key}`)}</Text>
              <View style={styles.valuePropIconWrap}>
                <Ionicons name={icon} size={iconSize.xl} color={colors.primary} />
              </View>
            </View>
          ))}
        </Animated.View>


        {/* Auth buttons */}
        <Animated.View style={[styles.buttons, buttonsStyle]}>
          {Platform.OS === 'ios' && (
            <AuthButton
              label={t('auth.continueWithApple')}
              btnStyle={styles.appleBtn}
              textStyle={styles.appleBtnText}
              onPress={handleApple}
              loading={appleLoading}
              icon={<Ionicons name="logo-apple" size={20} color="#FFFFFF" />} // brand-guard-allow: Apple's logo keeps its own white on the Apple button
            />
          )}
          <AuthButton
            label={t('auth.continueWithGoogle')}
            btnStyle={styles.googleBtn}
            textStyle={styles.googleBtnText}
            onPress={handleGoogle}
            loading={googleLoading}
            icon={<Text style={styles.googleGLetter}>G</Text>}
          />
          <TouchableOpacity
            testID="auth-guest-preview"
            style={styles.guestBtn}
            onPress={() => { setGuest(true); router.replace('/(guest)/feed'); }}
          >
            <Text style={styles.guestBtnText}>{t('auth.guestPreviewCta')}</Text>
          </TouchableOpacity>
          {/* FR-AUTH-001 AC2: the only route to email/password sign-in (and sign-up from there). */}
          <TouchableOpacity
            testID="auth-email-entry"
            style={styles.guestBtn}
            onPress={() => router.push('/(auth)/sign-in')}
            accessibilityRole="link"
          >
            <Text style={styles.emailEntryText}>{t('auth.continueWithEmail')}</Text>
          </TouchableOpacity>
        </Animated.View>

        <Animated.View style={[propsStyle, styles.miniAboutWrap]}>
          <AuthMiniAboutTeaser />
        </Animated.View>

        <Text style={styles.legal}>{t('auth.legalConsentShort')}</Text>
      </ScrollView>
      <NotifyModal
        visible={googleError !== null}
        title={t('auth.googleSignInFailedTitle')}
        message={googleError ?? ''}
        onDismiss={() => setGoogleError(null)}
      />
      <NotifyModal
        visible={appleError !== null}
        title={t('auth.appleSignInFailedTitle')}
        message={appleError ?? ''}
        onDismiss={() => setAppleError(null)}
      />
    </SafeAreaView>
  );
}

interface AuthButtonProps {
  label: string;
  icon: React.ReactNode;
  btnStyle: object;
  textStyle: object;
  onPress: () => void;
  loading?: boolean;
}

function AuthButton({ label, icon, btnStyle, textStyle, onPress, loading }: Readonly<AuthButtonProps>) {
  const styles = useWelcomeScreenStyles();
  const { colors } = useTheme();
  const scale = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const handlePressIn = () => { scale.value = withTiming(0.97, { duration: 100 }); };
  const handlePressOut = () => { scale.value = withSpring(1, { damping: 15 }); };

  return (
    <Animated.View style={pressStyle}>
      <TouchableOpacity
        style={[styles.authBtn, btnStyle, loading && styles.authBtnDisabled]}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color={(textStyle as { color?: string }).color ?? colors.textPrimary} />
        ) : (
          <>
            <Text style={[styles.authBtnText, textStyle]}>{label}</Text>
            <View style={styles.authBtnIconWrap}>{icon}</View>
          </>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}
