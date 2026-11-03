// app/apps/mobile/src/components/profile/FollowButton.tsx
// Five-state follow button per FR-FOLLOW-011. Hidden in the self state — the
// caller must check that itself; this component renders nothing for it.
// Confirm dialogs render via <ConfirmActionModal /> so they work on web (where
// react-native-web@0.21.2 makes Alert.alert a no-op).
// Mapped to: FR-FOLLOW-011, FR-FOLLOW-002 AC1, FR-FOLLOW-004 AC1.

import React from 'react';
import { TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';
import type { FollowState } from '@kc/application';
import { ConfirmActionModal } from '../post/ConfirmActionModal';

export type FollowButtonProps = Readonly<{
  state: FollowState;
  cooldownUntil?: string;
  onPress: () => void;
  busy?: boolean;
  /** True when account is not active — primary follow/request CTA stays disabled. */
  interactionDisabled?: boolean;
}>;

interface ButtonCfg {
  label: string;
  style?: object;
  textStyle?: object;
  disabled?: boolean;
  subtitle?: string;
  confirm?: { title: string; body: string; cta: string; destructive?: boolean };
}

export function FollowButton({
  state, cooldownUntil, onPress, busy, interactionDisabled,
}: FollowButtonProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  if (state === 'self') return null;

  const cfg = config(state, cooldownUntil, t, styles);
  const disabled = busy || cfg.disabled || Boolean(interactionDisabled);

  const handlePress = () => {
    if (disabled) return;
    if (cfg.confirm) setConfirmOpen(true);
    else onPress();
  };
  const handleConfirm = () => {
    setConfirmOpen(false);
    onPress();
  };

  return (
    <>
      <TouchableOpacity
        style={[styles.btn, cfg.style, disabled && styles.btnDisabled]}
        disabled={disabled}
        onPress={handlePress}
      >
        <Text style={[styles.text, cfg.textStyle]}>{cfg.label}</Text>
        {cfg.subtitle ? <Text style={styles.subtitle}>{cfg.subtitle}</Text> : null}
        {interactionDisabled && !cfg.subtitle ? (
          <Text style={styles.subtitle}>{t('profile.followUnavailable')}</Text>
        ) : null}
      </TouchableOpacity>
      {cfg.confirm ? (
        <ConfirmActionModal
          visible={confirmOpen}
          title={cfg.confirm.title}
          message={cfg.confirm.body}
          confirmLabel={cfg.confirm.cta}
          destructive={Boolean(cfg.confirm.destructive)}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={handleConfirm}
        />
      ) : null}
    </>
  );
}

function config(state: FollowState, cooldownUntil: string | undefined, t: TFunction, styles: ReturnType<typeof useStyles>): ButtonCfg {
  switch (state) {
    case 'not_following_public':
      return { label: t('profile.followCta') };
    case 'following':
      return {
        label: t('profile.followingActive'),
        style: styles.btnSecondary,
        textStyle: styles.textSecondary,
        confirm: {
          title: t('profile.unfollowConfirmTitle'),
          body: '',
          cta: t('profile.unfollowConfirmCta'),
          destructive: true,
        },
      };
    case 'not_following_private_no_request':
      return { label: t('profile.followRequestCta') };
    case 'request_pending':
      return {
        label: t('profile.requestSent'),
        style: styles.btnSecondary,
        textStyle: styles.textSecondary,
        confirm: {
          title: t('profile.cancelRequestTitle'),
          body: t('profile.cancelRequestBody'),
          cta: t('profile.cancelRequestCta'),
        },
      };
    case 'cooldown_after_reject': {
      const days = cooldownUntil ? Math.max(0, Math.ceil(
        (new Date(cooldownUntil).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      )) : 0;
      return {
        label: t('profile.followRequestCta'),
        disabled: true,
        subtitle: t('profile.cooldownRetryDays', { days }),
      };
    }
    default: return { label: '' };
  }
}

const useStyles = makeUseStyles(({ colors, isDark: _isDark }) => ({
  btn: {
    backgroundColor: colors.primary, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg,
    borderRadius: radius.md, alignItems: 'center', alignSelf: 'stretch',
  },
  btnSecondary: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border },
  btnDisabled: { opacity: 0.5 },
  text: { ...typography.button, color: colors.textInverse, fontWeight: '700' as const },
  textSecondary: { color: colors.textPrimary },
  subtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
}));
