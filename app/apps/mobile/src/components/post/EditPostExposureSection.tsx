// FR-POST-003, FR-POST-009, FR-POST-021 — exposure block on edit-post screen.
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';
import type { PostVisibility } from '@kc/domain';
import { useFeedSessionStore } from '../../store/feedSessionStore';
import { layoutDirectionStyle, layoutWritingDirectionStyle, textAlignStart } from '../../lib/rtlLayout';
import { VisibilityChooser } from './VisibilityChooser';
import { CounterpartyIdentityCard } from './CounterpartyIdentityCard';

interface Props {
  readonly visibility: PostVisibility;
  readonly onVisibilityChange: (next: PostVisibility) => void;
  readonly profilePrivacy: 'Public' | 'Private';
  readonly hideFromCounterparty: boolean;
  readonly onHideFromCounterpartyChange: (next: boolean) => void;
  readonly disabled?: boolean;
}

export function EditPostExposureSection({
  visibility,
  onVisibilityChange,
  profilePrivacy,
  hideFromCounterparty,
  onHideFromCounterpartyChange,
  disabled,
}: Props) {
  const { t } = useTranslation();
  const styles = useEditPostExposureSectionStyles();

  const handleVisibilityChange = (next: PostVisibility) => {
    onVisibilityChange(next);
    if (next === 'OnlyMe') onHideFromCounterpartyChange(true);
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.sectionTitle}>{t('post.exposureSettingsSectionTitle')}</Text>
      <Text style={styles.sectionIntro}>{t('post.exposureSettingsIntro')}</Text>
      <VisibilityChooser
        value={visibility}
        onChange={handleVisibilityChange}
        profilePrivacy={profilePrivacy}
        disabled={disabled}
        onFollowersOnlyBlockedPress={() =>
          useFeedSessionStore.getState().showEphemeralToast(
            t('post.visibilityFollowersLockedSub'),
            'success',
            3200,
          )
        }
      />
      <CounterpartyIdentityCard
        value={hideFromCounterparty}
        onChange={onHideFromCounterpartyChange}
        disabled={disabled}
      />
    </View>
  );
}

const useEditPostExposureSectionStyles = makeUseStyles(({ colors }) => ({
  wrap: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    ...layoutDirectionStyle(),
  },
  sectionTitle: {
    ...typography.button,
    color: colors.textPrimary,
    textAlign: textAlignStart(),
    ...layoutWritingDirectionStyle(),
  },
  sectionIntro: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: textAlignStart(),
    lineHeight: 18,
    ...layoutWritingDirectionStyle(),
  },
}));
