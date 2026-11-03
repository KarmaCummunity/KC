// FR-POST-003 — audience picker (Public / Followers / Only me). Shared by create + post menu.
import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';
import type { PostVisibility } from '@kc/domain';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { webTextRtl, webViewRtl } from '../../lib/webRtlStyle';

interface Props {
  value: PostVisibility;
  onChange: (next: PostVisibility) => void;
  /** FR-POST-003 AC4–AC5 — Followers-only requires a private profile. */
  profilePrivacy: 'Public' | 'Private';
  onFollowersOnlyBlockedPress?: () => void;
  /** When true, rows ignore presses (e.g. in-flight mutation). */
  disabled?: boolean;
}

const ROWS: { v: PostVisibility; labelKey: string; subKey: string }[] = [
  { v: 'Public', labelKey: 'post.visibilityPublic', subKey: 'post.visibilityPublicSub' },
  { v: 'FollowersOnly', labelKey: 'post.visibilityFollowers', subKey: 'post.visibilityFollowersSub' },
  { v: 'OnlyMe', labelKey: 'post.visibilityOnlyMe', subKey: 'post.visibilityOnlyMeSub' },
];

const useVisibilityChooserStyles = makeUseStyles(({ colors, isDark }) => ({
  section: { gap: spacing.xs, ...webViewRtl },
  sectionLabel: {
    ...typography.caption,
    ...typography.semiBold,
    color: colors.textSecondary,
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: isDark ? 1 : 1.5,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  rowActive: { borderColor: colors.primary, backgroundColor: colors.primarySurface },
  rowDisabled: { opacity: 0.55 },
  labelDisabled: { color: colors.textDisabled },
  subDisabled: { color: colors.textDisabled },
  radio: {
    width: 20,
    height: 20,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.border,
  },
  radioActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  label: {
    ...typography.caption,
    ...typography.semiBold,
    color: colors.textPrimary,
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
  sub: {
    ...typography.caption,
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    textAlign: rtlTextAlignStart,
    lineHeight: 16,
    ...webTextRtl,
  },
}));

export function VisibilityChooser({
  value,
  onChange,
  profilePrivacy,
  onFollowersOnlyBlockedPress,
  disabled: interactionDisabled,
}: Props) {
  const { t } = useTranslation();
  const styles = useVisibilityChooserStyles();
  const followersLocked = profilePrivacy === 'Public';

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{t('post.visibility')}</Text>
      {ROWS.map(({ v, labelKey, subKey }) => {
        const isFollowersRow = v === 'FollowersOnly';
        const followersRowLocked = isFollowersRow && followersLocked;
        const rowDisabled = Boolean(interactionDisabled) || followersRowLocked;
        const sub = followersRowLocked ? t('post.visibilityFollowersLockedSub') : t(subKey);
        return (
          <TouchableOpacity
            key={v}
            style={[styles.row, value === v && styles.rowActive, rowDisabled && styles.rowDisabled]}
            onPress={() => {
              if (interactionDisabled) return;
              if (followersRowLocked) {
                onFollowersOnlyBlockedPress?.();
                return;
              }
              onChange(v);
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected: value === v, disabled: rowDisabled }}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, rowDisabled && styles.labelDisabled]}>{t(labelKey)}</Text>
              <Text style={[styles.sub, rowDisabled && styles.subDisabled]}>{sub}</Text>
            </View>
            <View style={[styles.radio, value === v && styles.radioActive]} />
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
