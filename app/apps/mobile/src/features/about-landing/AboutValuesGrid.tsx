// Values grid — one kit brand tag chip per value (spec 17 §4.1, #1742).
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { makeUseStyles, spacing } from '@kc/ui';
import { Chip } from '../../components/ui/Chip';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface ValueItem {
  readonly icon: IoniconName;
  readonly label: string;
}

export function AboutValuesGrid() {
  const { t } = useTranslation();
  const styles = useAboutValuesGridStyles();
  const values: ValueItem[] = t('aboutContent.valuesList', { returnObjects: true }) as ValueItem[];

  return (
    <View style={styles.grid}>
      {values.map((v) => (
        <Chip key={v.label} variant="tag" tone="brand" size="sm" icon={v.icon} label={v.label} />
      ))}
    </View>
  );
}

const useAboutValuesGridStyles = makeUseStyles(() => ({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
}));
