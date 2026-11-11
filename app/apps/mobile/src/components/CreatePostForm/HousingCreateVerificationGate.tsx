// FR-HOUSING-003 AC2 (TD-245) — housing create/book pre-check: unverified members see the card,
// not the listing fields they cannot publish anyway.
import React, { useEffect, type ReactNode } from 'react';
import { ActivityIndicator, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
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

  useEffect(() => {
    if (level.isPending || (level.data ?? 0) >= 2) return;
    onPublishActionChange(null, false);
  }, [level.data, level.isPending, onPublishActionChange]);

  if (level.isPending) {
    return (
      <>
        {header}
        <ActivityIndicator testID="housing-verify-loading" />
      </>
    );
  }

  if ((level.data ?? 0) < 2) {
    const atLevel = level.data ?? 0;
    const ctaPath = atLevel < 1 ? '/edit-profile' : '/identity-verification';
    const ctaKey = atLevel < 1 ? 'housingStay.create.verifyCtaProfile' : 'housingStay.create.verifyCtaIdentity';
    const hintKey = atLevel < 1 ? 'housingStay.create.verifyBodyProfile' : 'housingStay.create.verifyBody';
    return (
      <>
        {header}
        <View style={styles.section} testID="housing-verify-gate">
          <Text style={styles.sectionLabel}>{t('housingStay.create.verifyTitle')}</Text>
          <Text style={styles.sectionHint}>{t(hintKey)}</Text>
          <TouchableOpacity
            accessibilityRole="button"
            style={styles.publishBtn}
            onPress={() => router.push(ctaPath)}
            testID="housing-verify-cta"
          >
            <Text style={[styles.publishBtnText, { color: colors.textInverse }]}>{t(ctaKey)}</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }

  return <>{children}</>;
}
