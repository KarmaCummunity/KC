// Values grid — visual icon chips (one per value).
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { makeUseStyles, typography, spacing, radius, useTheme, Text } from '@kc/ui';
import { aboutRtlText, aboutRtlRow } from './aboutWebRtlStyle';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface ValueItem {
  readonly icon: IoniconName;
  readonly label: string;
}

export function AboutValuesGrid() {
  const { t } = useTranslation();
  const styles = useAboutValuesGridStyles();
  const { colors } = useTheme();
  const values: ValueItem[] = t('aboutContent.valuesList', { returnObjects: true }) as ValueItem[];

  return (
    <View style={styles.grid}>
      {values.map((v) => (
        <View key={v.label} style={styles.chip}>
          <Ionicons name={v.icon} size={18} color={colors.primary} />
          <Text style={styles.label}>{v.label}</Text>
        </View>
      ))}
    </View>
  );
}

const useAboutValuesGridStyles = makeUseStyles(({ colors }) => ({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    flexDirection: aboutRtlRow,
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.primarySurface,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.primaryLight,
    shadowColor: colors.primary,
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  label: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '700',
    ...aboutRtlText,
  },
}));
