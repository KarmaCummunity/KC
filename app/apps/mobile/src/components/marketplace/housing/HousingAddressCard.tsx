// FR-HOUSING-012 AC2, AC5 — the exact place of a stay, read on demand. The server opens it only to
// the host and to the confirmed guest from approval until 24 h after the stay; anyone else gets
// the "opens after approval" line instead.
import React from 'react';
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { housingQueryKeys, housingUseCases } from '../../../services/housingComposition';
import { rtlTextAlignStart } from '../../../lib/rtlTextAlignStart';
import { valueOrNull } from '../../../lib/backendAvailability';

interface Props {
  readonly listingId: string;
}

export function HousingAddressCard({ listingId }: Props) {
  const { t } = useTranslation();
  const styles = useStyles();
  const place = useQuery({
    queryKey: housingQueryKeys.privateDetails(listingId),
    queryFn: () => valueOrNull(() => housingUseCases.privateDetails().execute(listingId)),
  });

  if (place.isPending) return null;
  const details = place.data;
  if (!details) return <Text style={styles.line}>{t('housingStay.addressHidden')}</Text>;

  // Optional lines appear only when the host filled them.
  const extra = [
    details.apartment ? t('housingStay.apartment', { value: details.apartment }) : null,
    details.floor ? t('housingStay.floor', { value: details.floor }) : null,
    details.entranceNotes ? t('housingStay.entrance', { value: details.entranceNotes }) : null,
    details.accessInstructions ? t('housingStay.access', { value: details.accessInstructions }) : null,
  ].filter((line): line is string => line !== null);

  return (
    <View style={styles.card} testID="housing-address-card">
      <Text style={typography.h3}>{t('housingStay.addressTitle')}</Text>
      <Text style={styles.street}>
        {t('housingStay.addressLine', { street: details.streetName, number: details.houseNumber })}
      </Text>
      {extra.map((line) => (
        <Text key={line} style={styles.line}>{line}</Text>
      ))}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  card: { gap: spacing.xs, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  street: { ...typography.bodyLarge, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  line: { ...typography.body, color: colors.textSecondary, textAlign: rtlTextAlignStart },
}));
