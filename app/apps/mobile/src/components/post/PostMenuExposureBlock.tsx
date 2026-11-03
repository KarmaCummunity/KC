// FR-POST-003, FR-POST-021 + D-32 — exposure controls inside post ⋮ menu (detail).
import { ActivityIndicator, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';
import { CounterpartyIdentityCard } from './CounterpartyIdentityCard';
import { usePostActorPrivacyModel } from '../../hooks/usePostActorPrivacyModel';
import type { PostWithOwner } from '@kc/application';
import { useFeedSessionStore } from '../../store/feedSessionStore';
import {
  crossAxisAlignStart,
  layoutDirectionStyle,
  layoutWritingDirectionStyle,
  textAlignStart,
} from '../../lib/rtlLayout';
import { VisibilityChooser } from './VisibilityChooser';

interface Props {
  readonly post: PostWithOwner;
  readonly viewerId: string;
}

export function PostMenuExposureBlock({ post, viewerId }: Props) {
  const { t } = useTranslation();
  const styles = usePostMenuExposureBlockStyles();
  const m = usePostActorPrivacyModel(post, viewerId);
  const isClosed = post.status === 'closed_delivered';

  const onFollowersBlocked = () =>
    useFeedSessionStore.getState().showEphemeralToast(t('post.visibilityFollowersLockedSub'), 'success', 3200);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('post.exposureSettingsSectionTitle')}</Text>
        {isClosed ? (
          <Text style={styles.hint}>{t('post.menuExposureClosedHint')}</Text>
        ) : null}
      </View>

      <VisibilityChooser
        value={m.audienceValue}
        onChange={m.onAudienceChange}
        profilePrivacy={m.profilePrivacy}
        disabled={m.saving}
        onFollowersOnlyBlockedPress={onFollowersBlocked}
      />

      {m.showCounterpartyRow ? (
        <CounterpartyIdentityCard
          value={m.hide}
          onChange={(next) => {
            if (m.saving) return;
            m.onHideChange(next);
          }}
          disabled={m.saving}
        />
      ) : null}

      {m.saving ? (
        <View style={styles.savingRow}>
          <ActivityIndicator size="small" />
          <Text style={styles.savingText}>{t('post.menuExposureSaving')}</Text>
        </View>
      ) : null}
    </View>
  );
}

const usePostMenuExposureBlockStyles = makeUseStyles(({ colors }) => ({
  card: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
    padding: spacing.md,
    gap: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    ...layoutDirectionStyle(),
  },
  header: { gap: spacing.xs, alignItems: crossAxisAlignStart },
  title: {
    ...typography.button,
    color: colors.textPrimary,
    textAlign: textAlignStart(),
    ...layoutWritingDirectionStyle(),
  },
  hint: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: textAlignStart(),
    lineHeight: 18,
    ...layoutWritingDirectionStyle(),
  },
  savingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingTop: spacing.xs,
  },
  savingText: {
    ...typography.caption,
    color: colors.textSecondary,
    ...layoutWritingDirectionStyle(),
  },
}));
