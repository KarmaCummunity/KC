// FR-HOUSING-003 AC2 (TD-245) — housing create pre-check: incomplete profiles see the card,
// not the listing fields. Until Didit IDV ships (#1037), complete profile unlocks housing.
import React, { useEffect, type ReactNode } from 'react';
import { ActivityIndicator, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { meetsVerificationRequirement } from '@kc/domain';
import { Text, useTheme } from '@kc/ui';
import { useViewerVerificationLevel } from '../../hooks/useViewerVerificationLevel';
import { useCreatePostStyles } from '../../screens/tabs/create.styles';

interface Props {
  readonly header: ReactNode;
  readonly children: ReactNode;
  readonly onPublishActionChange: (action: (() => void) | null, loading: boolean) => void;
}

export function HousingCreateVerificationGate({ header, children, onPublishActionChange }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useCreatePostStyles();
  const router = useRouter();
  const level = useViewerVerificationLevel();
  const atLevel = level.data ?? 0;
  // Spec still names level 2 for housing; live product caps the requirement at complete profile.
  const unlocked = meetsVerificationRequirement(atLevel, 2);

  useEffect(() => {
    if (level.isPending || unlocked) return;
    onPublishActionChange(null, false);
  }, [level.isPending, unlocked, onPublishActionChange]);

  if (level.isPending) {
    return (
      <>
        {header}
        <ActivityIndicator testID="housing-verify-loading" />
      </>
    );
  }

  if (!unlocked) {
    return (
      <>
        {header}
        <View style={styles.section} testID="housing-verify-gate">
          <Text style={styles.sectionLabel}>{t('housingStay.create.verifyTitle')}</Text>
          <Text style={styles.sectionHint}>{t('housingStay.create.verifyBodyProfile')}</Text>
          <TouchableOpacity
            accessibilityRole="button"
            style={styles.publishBtn}
            onPress={() => router.push('/edit-profile')}
            testID="housing-verify-cta"
          >
            <Text style={[styles.publishBtnText, { color: colors.textInverse }]}>
              {t('housingStay.create.verifyCtaProfile')}
            </Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }

  return <>{children}</>;
}
