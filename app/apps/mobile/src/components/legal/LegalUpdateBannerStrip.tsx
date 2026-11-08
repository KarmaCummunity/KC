import { Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { LegalPendingItem } from '@kc/domain';
import { typography, spacing, useTheme, Text } from '@kc/ui';
import { layoutWritingDirectionStyle, rtlTextAlignStart } from '../../lib/rtlLayout';
import { legalUpdateDaysRemaining } from './legalConsentRules';

interface LegalUpdateBannerStripProps {
  readonly pending: readonly LegalPendingItem[];
  readonly onOpen: () => void;
}

/** In-shell strip shown while a legal-document update is pending acceptance. */
export function LegalUpdateBannerStrip({ pending, onOpen }: LegalUpdateBannerStripProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onOpen}
      style={{
        backgroundColor: colors.warningLight,
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.md,
      }}
    >
      <Text
        style={{
          ...typography.bodySmall,
          color: colors.textPrimary,
          textAlign: rtlTextAlignStart,
          ...layoutWritingDirectionStyle(),
        }}
      >
        {t('legal.updateBannerHeading')} ·{' '}
        {t('legal.updateBannerCountdown', { days: legalUpdateDaysRemaining(pending) })}
      </Text>
    </Pressable>
  );
}
