// FR-AUTH-006 — verification-pending state shown inside sign-up and sign-in screens.
// Renders email-icon header, three actions: open mail, resend (60s cooldown), change email.
import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { isAuthError } from '@kc/application';
import { mapAuthErrorToHebrew } from '../../services/authMessages';
import {
  AUTH_VERIFY_URL,
  getResendVerificationEmailUseCase,
} from '../../services/authComposition';
import { openMail } from '../../lib/openMail';
import { GhostButton, PrimaryButton, SecondaryButton } from '../ui/Buttons';

const RESEND_COOLDOWN_SECONDS = 60;

export interface VerificationPendingPanelProps {
  email: string;
  onChangeEmail: () => void;
}

export function VerificationPendingPanel(props: VerificationPendingPanelProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  const { email, onChangeEmail } = props;
  const [cooldown, setCooldown] = useState(0);
  const [resending, setResending] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  const [resendOk, setResendOk] = useState(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (cooldown <= 0) {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
      return;
    }
    if (!tickRef.current) {
      tickRef.current = setInterval(() => {
        setCooldown((c) => Math.max(0, c - 1));
      }, 1000);
    }
    return () => {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
  }, [cooldown]);

  const onOpenMail = () => {
    void openMail(email);
  };

  const onResend = async () => {
    if (cooldown > 0 || resending) return;
    setResending(true);
    setResendError(null);
    setResendOk(false);
    try {
      await getResendVerificationEmailUseCase().execute({
        email,
        emailRedirectTo: AUTH_VERIFY_URL,
      });
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setResendOk(true);
    } catch (err) {
      const message = isAuthError(err) ? mapAuthErrorToHebrew(err.code) : t('auth.networkError');
      setResendError(message);
    } finally {
      setResending(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>📧</Text>
      <Text style={styles.title}>{t('auth.verifyTitle')}</Text>
      <Text style={styles.body}>
        {t('auth.verifyBodyBefore')}<Text style={styles.bodyBold}>{email}</Text>{t('auth.verifyBodyAfter')}
      </Text>

      <PrimaryButton label={t('auth.openMail')} size="md" fullWidth onPress={onOpenMail} />

      <SecondaryButton
        label={cooldown > 0 ? t('auth.resendWithCountdown', { count: cooldown }) : t('auth.resendOtp')}
        size="md"
        fullWidth
        loading={resending}
        disabled={cooldown > 0}
        onPress={onResend}
      />

      {resendOk ? <Text style={styles.helperOk}>{t('auth.resendOk')}</Text> : null}
      {resendError ? <Text style={styles.helperErr}>{resendError}</Text> : null}

      <GhostButton label={t('auth.changeEmail')} size="md" fullWidth onPress={onChangeEmail} />
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  container: { gap: spacing.base, paddingTop: spacing.lg },
  icon: { fontSize: 48, textAlign: 'center' }, // brand-guard-allow: hero emoji glyph, off the type scale
  title: { ...typography.h2, color: colors.textPrimary, textAlign: 'center' },
  body: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  bodyBold: { ...typography.body, ...typography.bold, color: colors.textPrimary },
  helperOk: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' },
  helperErr: { ...typography.caption, color: colors.error, textAlign: 'center' },
}));
