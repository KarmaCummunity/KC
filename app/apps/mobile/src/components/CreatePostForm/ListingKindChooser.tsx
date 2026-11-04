// Mapped to spec: FR-POST-001 AC6 — a world with several kinds per direction (animals: hand an animal
// over or offer boarding; knowledge: a course or a private lesson) asks which one the member means.
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Text } from '@kc/ui';
import type { ListingKindOption } from '@kc/domain';
import { useCreatePostStyles } from '../../screens/tabs/create.styles';
import { Chip } from '../ui/Chip';

interface Props {
  readonly choices: readonly ListingKindOption[];
  readonly selectedKindId: string | null;
  readonly onChoose: (slug: string) => void;
  readonly disabled?: boolean;
}

export function ListingKindChooser({ choices, selectedKindId, onChoose, disabled = false }: Props) {
  const { t, i18n } = useTranslation();
  const styles = useCreatePostStyles();
  if (choices.length < 2) return null;
  const isHebrew = i18n.language.startsWith('he');
  return (
    <View style={styles.section} testID="listing-kind-chooser">
      <Text style={styles.sectionLabel}>{t('post.unifiedCreate.kindLabel')}</Text>
      <View style={styles.chipWrap}>
        {choices.map((k) => (
          <Chip
            key={k.kindId}
            testID={`listing-kind-${k.slug}`}
            label={isHebrew ? k.labelHe : k.labelEn}
            selected={k.kindId === selectedKindId}
            onPress={() => onChoose(k.slug)}
            disabled={disabled}
          />
        ))}
      </View>
    </View>
  );
}
