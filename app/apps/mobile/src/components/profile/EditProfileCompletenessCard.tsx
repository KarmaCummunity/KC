// FR-VERIFY-012 — lists profile fields still missing for verification level 1.
import React, { useMemo } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { missingCompleteProfileFields, type CompleteProfileField } from '@kc/domain';
import { iconSize, makeUseStyles, radius, spacing, typography, useTheme, Text } from '@kc/ui';
import { Card } from '../ui/Card';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

const FIELD_I18N: Record<CompleteProfileField, string> = {
  displayName: 'profile.editScreen.completeField.displayName',
  city: 'profile.editScreen.completeField.city',
  dateOfBirth: 'profile.editScreen.completeField.dateOfBirth',
  avatarUrl: 'profile.editScreen.completeField.avatarUrl',
  profileStreet: 'profile.editScreen.completeField.profileStreet',
  profileStreetNumber: 'profile.editScreen.completeField.profileStreetNumber',
  contactPhone: 'profile.editScreen.completeField.contactPhone',
};

type Props = {
  readonly displayName: string;
  readonly cityId: string | null;
  readonly dateOfBirth: string | null;
  readonly avatarUrl: string | null;
  readonly profileStreet: string;
  readonly profileStreetNumber: string;
  readonly contactPhone: string;
};

export function EditProfileCompletenessCard(props: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useStyles();

  const missing = useMemo(
    () => missingCompleteProfileFields({
      displayName: props.displayName.trim() || null,
      city: props.cityId,
      dateOfBirth: props.dateOfBirth,
      avatarUrl: props.avatarUrl,
      profileStreet: props.profileStreet.trim() || null,
      profileStreetNumber: props.profileStreetNumber.trim() || null,
      contactPhone: props.contactPhone.trim() || null,
    }),
    [props],
  );

  if (missing.length === 0) return null;

  return (
    <Card padding="sm" style={styles.card} testID="edit-profile-completeness-card">
      <View style={styles.header}>
        <Ionicons name="shield-checkmark-outline" size={iconSize.lg} color={colors.primary} />
        <View style={styles.headerText}>
          <Text style={styles.title}>{t('profile.editScreen.completeProfileCardTitle')}</Text>
          <Text style={styles.body}>{t('profile.editScreen.completeProfileCardBody')}</Text>
        </View>
      </View>
      {missing.map((key) => (
        <Text key={key} style={styles.missingItem}>
          {t('profile.editScreen.completeField.bullet', { field: t(FIELD_I18N[key]) })}
        </Text>
      ))}
    </Card>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  card: { marginBottom: spacing.md, gap: spacing.xs },
  header: { flexDirection: 'row' as const, gap: spacing.sm, alignItems: 'flex-start' as const },
  headerText: { flex: 1, gap: spacing.xs },
  title: { ...typography.bodySmall, ...typography.bold, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  body: { ...typography.caption, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  missingItem: {
    ...typography.caption,
    color: colors.textPrimary,
    textAlign: rtlTextAlignStart,
    paddingStart: spacing.sm,
    borderStartWidth: 2,
    borderStartColor: colors.primary,
    borderRadius: radius.xs,
  },
}));
