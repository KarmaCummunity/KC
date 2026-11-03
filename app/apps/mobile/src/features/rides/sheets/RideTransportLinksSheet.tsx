// FR-RIDE-002 — NGO transport links in a dedicated sheet (not on rides hub main feed).
// The frame, dismissal and motion come from the kit `BottomSheet` (spec 17 §4.1).
import React from 'react';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, typography, Text } from '@kc/ui';
import { DonationLinksList } from '../../../components/DonationLinksList';
import { BottomSheet } from '../../../components/ui/BottomSheet';
import { rtlTextAlignStart } from '../../../lib/rtlTextAlignStart';

const useStyles = makeUseStyles(({ colors }) => ({
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: rtlTextAlignStart,
  },
}));

interface Props {
  readonly visible: boolean;
  readonly onClose: () => void;
}

export function RideTransportLinksSheet({ visible, onClose }: Props) {
  const { t } = useTranslation();
  const styles = useStyles();

  return (
    <BottomSheet visible={visible} onDismiss={onClose} title={t('donations.rides.linksSheetTitle')}>
      <Text style={styles.subtitle}>{t('donations.rides.linksSheetSubtitle')}</Text>
      <DonationLinksList categorySlug="transport" />
    </BottomSheet>
  );
}
