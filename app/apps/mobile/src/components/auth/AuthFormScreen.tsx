// Shared frame of the email sign-in and sign-up screens — FR-AUTH-006 / FR-AUTH-007 (email path).
//
// Owns everything the two screens have in common: the entry motion, the header
// (back + logo), the form card with its title, the Google block above the
// form, the address and password fields with the submit button, the
// verification-pending panel that replaces the form once an address awaits
// confirmation, and the error dialog. State comes from `useAuthEmailForm`; each
// screen adds its own labels, an optional action above the submit and its
// "switch screen" link as `footer`.
import React, { useEffect } from 'react';
import { View, TouchableOpacity, KeyboardAvoidingView, Platform, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withSpring, withDelay } from 'react-native-reanimated';
import { makeUseStyles, typography, spacing, radius, shadow, iconSize, useTheme, Text } from '@kc/ui';
import { VerificationPendingPanel } from './VerificationPendingPanel';
import { AuthSocialSignInBlock } from './AuthSocialSignInBlock';
import { AuthLanguageToggle } from './AuthLanguageToggle';
import { NotifyModal } from '../NotifyModal';
import { AmbientBlobs } from '../ui/AmbientBlobs';
import { AnimatedAuthInput } from './AnimatedAuthInput';
import { PrimaryButton } from '../ui/Buttons';
import { MirroredIcon, useDirectionalBackIcon } from '../ui/MirroredIcon';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import type { AuthEmailForm } from './useAuthEmailForm';
import { useKeyboardVerticalOffset } from '../../lib/platform/useKeyboardVerticalOffset';
import { resolveKeyboardAvoidingBehavior } from '../../lib/platform/keyboardVerticalOffset';
import { FormScope } from '../ui/FormScope';

/** Side of the logo in the header, in points (a layout size). */
const LOGO_SIZE = 48;

export interface AuthFormScreenProps {
  readonly title: string;
  readonly subtitle?: string;
  /** Form state and submit flow (`useAuthEmailForm`). */
  readonly form: AuthEmailForm;
  readonly passwordLabel: string;
  readonly passwordPlaceholder: string;
  readonly submitLabel: string;
  /** Extra action between the fields and the submit (e.g. "forgot password"). */
  readonly beforeSubmit?: React.ReactNode;
  /** Shown under the form while no address is pending (the "switch screen" link). */
  readonly footer: React.ReactNode;
}

/** Fades the screen in and slides the header and the card into place. */
function useEntryMotion() {
  const screenOpacity = useSharedValue(0);
  const headerTranslate = useSharedValue(-20);
  const formOpacity = useSharedValue(0);
  const formTranslate = useSharedValue(30);

  useEffect(() => {
    screenOpacity.value = withTiming(1, { duration: 300 });
    headerTranslate.value = withSpring(0, { damping: 20, stiffness: 120 });
    formOpacity.value = withDelay(150, withTiming(1, { duration: 400 }));
    formTranslate.value = withDelay(150, withSpring(0, { damping: 18, stiffness: 100 }));
  }, [screenOpacity, headerTranslate, formOpacity, formTranslate]);

  return {
    screen: useAnimatedStyle(() => ({ opacity: screenOpacity.value })),
    header: useAnimatedStyle(() => ({ transform: [{ translateY: headerTranslate.value }] })),
    form: useAnimatedStyle(() => ({ opacity: formOpacity.value, transform: [{ translateY: formTranslate.value }] })),
  };
}

export function AuthFormScreen({
  title,
  subtitle,
  form,
  passwordLabel,
  passwordPlaceholder,
  submitLabel,
  beforeSubmit,
  footer,
}: AuthFormScreenProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const motion = useEntryMotion();
  const backIcon = useDirectionalBackIcon();
  const keyboardOffset = useKeyboardVerticalOffset({ headerless: true });

  return (
    <SafeAreaView style={styles.container}>
      <FormScope>
        <AmbientBlobs density="auth" />
        <Animated.View style={[styles.fill, motion.screen]}>
          <KeyboardAvoidingView
            behavior={resolveKeyboardAvoidingBehavior(Platform.OS)}
            style={styles.fill}
            keyboardVerticalOffset={keyboardOffset}
          >
            <View style={styles.content}>
              <Animated.View style={[styles.header, motion.header]}>
                <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
                  <MirroredIcon name={backIcon} size={iconSize.xl} color={colors.primary} />
                </TouchableOpacity>
                <AuthLanguageToggle />
                <Image source={require('../../../assets/logo.png')} style={styles.logo} resizeMode="contain" />
              </Animated.View>

              <Animated.View style={[styles.card, motion.form]}>
                <Text style={[styles.title, subtitle ? styles.titleWithSubtitle : null]}>{title}</Text>
                {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

                {form.pendingEmail ? (
                  <VerificationPendingPanel email={form.pendingEmail} onChangeEmail={form.clearPendingEmail} />
                ) : (
                  <AuthSocialSignInBlock />
                )}

                {/* Kept mounted while an address is pending, so "change address" returns to the typed values. */}
                <View style={[styles.form, form.pendingEmail ? styles.hidden : null]}>
                  <AuthCredentialFields
                    form={form}
                    passwordLabel={passwordLabel}
                    passwordPlaceholder={passwordPlaceholder}
                    submitLabel={submitLabel}
                    beforeSubmit={beforeSubmit}
                  />
                </View>

                {form.pendingEmail ? null : <View style={styles.footer}>{footer}</View>}
              </Animated.View>
            </View>
          </KeyboardAvoidingView>
        </Animated.View>
        <NotifyModal
          visible={form.notice !== null}
          title={form.notice?.title ?? ''}
          message={form.notice?.message ?? ''}
          onDismiss={form.dismissNotice}
        />
      </FormScope>
    </SafeAreaView>
  );
}

/** The props the credential fields read: the form state, the password labels and the submit. */
type AuthCredentialFieldsProps = Pick<
  AuthFormScreenProps,
  'form' | 'passwordLabel' | 'passwordPlaceholder' | 'submitLabel' | 'beforeSubmit'
>;

/** Address and password inputs, the optional extra action and the submit. */
function AuthCredentialFields({
  form,
  passwordLabel,
  passwordPlaceholder,
  submitLabel,
  beforeSubmit,
}: AuthCredentialFieldsProps) {
  const { t } = useTranslation();
  return (
    <>
      <AnimatedAuthInput
        testID="auth-email"
        label={t('auth.email')}
        value={form.email}
        onChangeText={form.setEmail}
        placeholder={t('auth.emailPlaceholder')}
        editable={!form.loading}
        inputKind="email"
      />
      <AnimatedAuthInput
        testID="auth-password"
        label={passwordLabel}
        value={form.password}
        onChangeText={form.setPassword}
        placeholder={passwordPlaceholder}
        secureTextEntry
        editable={!form.loading}
      />
      {beforeSubmit}
      {/* Literal id: the Maestro flows (and their testID checker) target the submit by it. */}
      <PrimaryButton testID="auth-submit" label={submitLabel} loading={form.loading} onPress={form.handleSubmit} />
    </>
  );
}

const useStyles = makeUseStyles(({ colors, isDark }) => ({
  container: { flex: 1, backgroundColor: colors.surfaceCream },
  fill: { flex: 1 },
  content: { flex: 1, paddingHorizontal: spacing.xl, paddingTop: spacing.md },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xl,
  },
  backBtn: { padding: spacing.sm },
  logo: { width: LOGO_SIZE, height: LOGO_SIZE, borderRadius: radius.md },
  card: {
    backgroundColor: colors.surface,
    borderWidth: isDark ? 1 : 0,
    borderColor: isDark ? colors.border : 'transparent',
    borderRadius: radius.xl,
    padding: spacing.xl,
    // The neutral card lift in light mode; dark mode relies on the border alone.
    shadowColor: colors.shadow,
    shadowOffset: shadow.card.shadowOffset,
    shadowOpacity: isDark ? 0 : shadow.card.shadowOpacity,
    shadowRadius: shadow.card.shadowRadius,
    elevation: isDark ? 0 : shadow.card.elevation,
  },
  title: { ...typography.h1, color: colors.textPrimary, textAlign: rtlTextAlignStart, marginBottom: spacing.xl },
  titleWithSubtitle: { marginBottom: spacing.xs },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: rtlTextAlignStart, marginBottom: spacing.xl },
  form: { gap: spacing.base },
  hidden: { display: 'none' },
  footer: { marginTop: spacing.base, gap: spacing.xs },
}));
