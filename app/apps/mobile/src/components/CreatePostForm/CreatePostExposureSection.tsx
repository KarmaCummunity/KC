import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { iconSize, useTheme, Text } from '@kc/ui';
import { CounterpartyIdentityCard } from '../post/CounterpartyIdentityCard';
import type { LocationDisplayLevel, PostVisibility } from '@kc/domain';
import { useFeedSessionStore } from '../../store/feedSessionStore';
import { useCreatePostStyles } from '../../screens/tabs/create.styles';
import { LocationDisplayLevelChooser } from './LocationDisplayLevelChooser';
import { VisibilityChooser } from '../post/VisibilityChooser';

export interface CreatePostExposureSectionProps {
  open: boolean;
  onToggleOpen: () => void;
  locationDisplayLevel: LocationDisplayLevel;
  onLocationDisplayLevelChange: (next: LocationDisplayLevel) => void;
  isPublishing: boolean;
  visibility: PostVisibility;
  onVisibilityChange: (next: PostVisibility) => void;
  profilePrivacy: 'Public' | 'Private';
  hideFromCounterparty: boolean;
  onHideFromCounterpartyChange: (next: boolean) => void;
}

export function CreatePostExposureSection({
  open,
  onToggleOpen,
  locationDisplayLevel,
  onLocationDisplayLevelChange,
  isPublishing,
  visibility,
  onVisibilityChange,
  profilePrivacy,
  hideFromCounterparty,
  onHideFromCounterpartyChange,
}: Readonly<CreatePostExposureSectionProps>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useCreatePostStyles();

  return (
    <View style={styles.exposureAccordion}>
      <TouchableOpacity
        style={styles.exposureAccordionHeader}
        onPress={onToggleOpen}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={t('post.exposureSettingsSectionTitle')}
      >
        <Text style={styles.exposureAccordionTitle}>{t('post.exposureSettingsSectionTitle')}</Text>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={iconSize.xl}
          color={colors.textSecondary}
        />
      </TouchableOpacity>
      {open ? (
        <View style={styles.exposureAccordionBody}>
          <Text style={styles.exposureIntro}>{t('post.exposureSettingsIntro')}</Text>
          <LocationDisplayLevelChooser
            value={locationDisplayLevel}
            onChange={onLocationDisplayLevelChange}
            disabled={isPublishing}
          />

          <VisibilityChooser
            value={visibility}
            onChange={(next) => {
              onVisibilityChange(next);
              if (next === 'OnlyMe') onHideFromCounterpartyChange(true);
            }}
            profilePrivacy={profilePrivacy}
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
            disabled={isPublishing}
          />
        </View>
      ) : null}
    </View>
  );
}
