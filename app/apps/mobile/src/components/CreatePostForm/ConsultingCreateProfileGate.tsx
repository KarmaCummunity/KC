// FR-KNOW-012 AC1 / D184 — consulting hour create pre-check: members below a complete
// profile (verification level < 1) see this card instead of the form fields they cannot
// publish. Identity verification is not required (S70 → D184). Housing pattern reuse.
import React, { useEffect, type ReactNode } from 'react';
import { ActivityIndicator, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Text, useTheme } from '@kc/ui';
import { useViewerVerificationLevel } from '../../hooks/useViewerVerificationLevel';
import { useCreatePostStyles } from '../../screens/tabs/create.styles';

interface Props {
  readonly children: ReactNode;
  readonly onPublishActionChange: (action: (() => void) | null, loading: boolean) => void;
}

export function ConsultingCreateProfileGate({ children, onPublishActionChange }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useCreatePostStyles();
  const router = useRouter();
  const level = useViewerVerificationLevel();

  useEffect(() => {
    if (level.isPending || (level.data ?? 0) >= 1) return;
    onPublishActionChange(null, false);
  }, [level.data, level.isPending, onPublishActionChange]);

  if (level.isPending) {
    return <ActivityIndicator testID="consulting-profile-loading" />;
  }

  if ((level.data ?? 0) < 1) {
    return (
      <View style={styles.section} testID="consulting-profile-gate">
        <Text style={styles.sectionLabel}>{t('knowledgeTrust.create.verifyTitle')}</Text>
        <Text style={styles.sectionHint}>{t('knowledgeTrust.create.verifyBody')}</Text>
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.publishBtn}
          onPress={() => router.push('/edit-profile')}
          testID="consulting-profile-cta"
        >
          <Text style={[styles.publishBtnText, { color: colors.textInverse }]}>
            {t('knowledgeTrust.create.verifyCta')}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return <>{children}</>;
}
