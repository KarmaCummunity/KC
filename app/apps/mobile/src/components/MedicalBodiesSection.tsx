// FR-DONATE-011 — curated directory of life-saving / medical bodies (blood, organs, first aid…).
// Presentational only: reads static config from `medicalBodies.ts`, copy from i18n,
// and opens the official site in the external browser. No network or storage side-effects.
import React, { useCallback } from 'react';
import { Alert, Linking, Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { iconSize, makeUseStyles, radius, spacing, Text, typography, useTheme } from '@kc/ui';
import { MEDICAL_SECTIONS, type MedicalBody } from '../features/donations/medicalBodies';
import { rtlTextAlignStart } from '../lib/rtlTextAlignStart';

const useStyles = makeUseStyles(({ colors }) => ({
  container: { gap: spacing.lg },
  sectionsTitle: { ...typography.h2, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  section: { gap: spacing.sm },
  sectionHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm },
  sectionTexts: { flex: 1, minWidth: 0 },
  sectionTitle: { ...typography.h3, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  sectionSubtitle: { ...typography.caption, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  card: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    minHeight: 44,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cardPressed: { opacity: 0.85 },
  cardTexts: { flex: 1, minWidth: 0, gap: spacing.xs },
  cardName: { ...typography.h3, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  cardDescription: { ...typography.body, color: colors.textSecondary, textAlign: rtlTextAlignStart },
}));

export function MedicalBodiesSection() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useStyles();

  // Surface a localized alert instead of failing silently when the OS cannot open the URL.
  const openBody = useCallback(
    async (body: MedicalBody) => {
      try {
        if (!(await Linking.canOpenURL(body.url))) throw new Error('unsupported_url');
        await Linking.openURL(body.url);
      } catch {
        Alert.alert(t('medicalBodies.linkError'));
      }
    },
    [t],
  );

  return (
    <View style={styles.container} testID="medical-bodies-section">
      <Text style={styles.sectionsTitle}>{t('medicalBodies.sectionsTitle')}</Text>
      {MEDICAL_SECTIONS.map((section) => (
        <View key={section.id} style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name={section.icon} size={iconSize.xl} color={colors.primary} />
            <View style={styles.sectionTexts}>
              <Text style={styles.sectionTitle}>{t(`medicalBodies.sections.${section.id}.title`)}</Text>
              <Text style={styles.sectionSubtitle}>{t(`medicalBodies.sections.${section.id}.subtitle`)}</Text>
            </View>
          </View>
          {section.bodies.map((body) => {
            const name = t(`medicalBodies.items.${body.id}.name`);
            return (
              <Pressable
                key={body.id}
                accessibilityRole="link"
                accessibilityLabel={t('medicalBodies.openA11y', { name })}
                testID={`medical-body-${body.id}`}
                onPress={() => openBody(body)}
                style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
              >
                <View style={styles.cardTexts}>
                  <Text style={styles.cardName}>{name}</Text>
                  <Text style={styles.cardDescription}>{t(`medicalBodies.items.${body.id}.description`)}</Text>
                </View>
                <Ionicons name="open-outline" size={iconSize.md} color={colors.textSecondary} />
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}
