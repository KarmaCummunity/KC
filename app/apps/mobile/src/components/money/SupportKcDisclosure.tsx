// FR-DONATE-011 — donor-facing legal notice for supporting KC directly:
// secure off-app payment, recipient and use of funds, no section-46 tax credit,
// voluntary (no in-app benefit), and — when a standing order is offered — how to
// cancel it (written request through the support chat).
import React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, radius, spacing, typography, useTheme, Text, iconSize } from '@kc/ui';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { useKcStandingOrderCancelRequest } from '../../hooks/useKcStandingOrderCancelRequest';

const BASE_LINES = [
  { key: 'disclosureSecure', icon: 'lock-closed-outline' },
  { key: 'disclosureRecipient', icon: 'people-outline' },
  { key: 'disclosureTax', icon: 'receipt-outline' },
  { key: 'disclosureVoluntary', icon: 'hand-left-outline' },
] as const;

const CANCEL_LINE = { key: 'disclosureCancel', icon: 'calendar-outline' } as const;

const useStyles = makeUseStyles(({ colors }) => ({
  box: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    gap: spacing.sm,
  },
  title: { ...typography.h4, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  line: { flexDirection: 'row' as const, gap: spacing.sm, alignItems: 'flex-start' as const },
  lineText: { ...typography.bodySmall, color: colors.textSecondary, flex: 1, textAlign: rtlTextAlignStart },
  cancel: {
    minHeight: 44,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.xs,
  },
  cancelText: { ...typography.body, color: colors.primary, ...typography.semiBold },
  error: { ...typography.bodySmall, color: colors.error, textAlign: rtlTextAlignStart },
}));

/** Link that files a written standing-order cancellation request (signed-in donors only). */
function CancelStandingOrderLink() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useStyles();
  const { canRequest, busy, failed, request } = useKcStandingOrderCancelRequest();
  if (!canRequest) return null;
  return (
    <>
      <Pressable
        style={styles.cancel}
        onPress={() => void request()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityState={{ busy, disabled: busy }}
        testID="support-kc-cancel-standing-order"
      >
        {busy ? <ActivityIndicator size="small" color={colors.primary} /> : null}
        <Text style={styles.cancelText}>{t('supportKc.cancelCta')}</Text>
      </Pressable>
      {failed ? <Text style={styles.error} accessibilityLiveRegion="polite">{t('supportKc.cancelError')}</Text> : null}
    </>
  );
}

export function SupportKcDisclosure({ hasStandingOrder }: { readonly hasStandingOrder: boolean }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useStyles();
  const lines = hasStandingOrder ? [...BASE_LINES, CANCEL_LINE] : BASE_LINES;
  return (
    <View style={styles.box} testID="support-kc-disclosure">
      <Text style={styles.title} accessibilityRole="header">{t('supportKc.disclosureTitle')}</Text>
      {lines.map(({ key, icon }) => (
        <View key={key} style={styles.line}>
          <Ionicons name={icon} size={iconSize.sm} color={colors.textSecondary} />
          <Text style={styles.lineText}>{t(`supportKc.${key}`)}</Text>
        </View>
      ))}
      {hasStandingOrder ? <CancelStandingOrderLink /> : null}
    </View>
  );
}
