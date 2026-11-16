// Mapped to spec: FR-POST-003 / FR-POST-009 / FR-POST-021 — "exposure settings", the one block every
// create and edit form ends with: who sees the post, how much of the address is shown, and whether
// the counterparty sees who published it. Closed by default; it keeps its own open state.
import React, { useState } from 'react';
import { TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { iconSize, useTheme, Text } from '@kc/ui';
import { CounterpartyIdentityCard } from './CounterpartyIdentityCard';
import type { LocationDisplayLevel, PostVisibility } from '@kc/domain';
import { useFeedSessionStore } from '../../store/feedSessionStore';
import { useCreatePostStyles } from '../../screens/tabs/create.styles';
import { LocationDisplayLevelChooser } from '../CreatePostForm/LocationDisplayLevelChooser';
import { VisibilityChooser } from './VisibilityChooser';

export interface ExposureSettingsSectionProps {
  /** Omit for a post with no address to display (a ride): the address level is then not offered. */
  readonly locationDisplayLevel?: LocationDisplayLevel;
  readonly onLocationDisplayLevelChange?: (next: LocationDisplayLevel) => void;
  readonly visibility: PostVisibility;
  readonly onVisibilityChange: (next: PostVisibility) => void;
  readonly profilePrivacy: 'Public' | 'Private';
  readonly hideFromCounterparty: boolean;
  readonly onHideFromCounterpartyChange: (next: boolean) => void;
  readonly disabled?: boolean;
}

export function ExposureSettingsSection({
  locationDisplayLevel,
  onLocationDisplayLevelChange,
  visibility,
  onVisibilityChange,
  profilePrivacy,
  hideFromCounterparty,
  onHideFromCounterpartyChange,
  disabled,
}: Readonly<ExposureSettingsSectionProps>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useCreatePostStyles();
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.exposureAccordion}>
      <TouchableOpacity
        style={styles.exposureAccordionHeader}
        onPress={() => setOpen((wasOpen) => !wasOpen)}
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
          {locationDisplayLevel && onLocationDisplayLevelChange ? (
            <LocationDisplayLevelChooser value={locationDisplayLevel} onChange={onLocationDisplayLevelChange} disabled={disabled} />
          ) : null}

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
            disabled={disabled}
          />
        </View>
      ) : null}
    </View>
  );
}
