// FR-DONATE-011 AC9 — "or transfer manually to <phone>" under a Bit / PayBox button.
// The number comes from the server (signed-in users only, migration 0550) and is
// selectable; the copy action uses the browser clipboard on web and the system
// share sheet (which offers "Copy") on iOS / Android.
import React, { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { formatPayeePhone } from '@kc/domain';
import { makeUseStyles, spacing, typography, useTheme, Text, iconSize } from '@kc/ui';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { copyOrShareText } from '../../lib/copyOrShareText';

const useStyles = makeUseStyles(({ colors }) => ({
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm },
  text: { ...typography.bodySmall, color: colors.textSecondary, flex: 1, textAlign: rtlTextAlignStart },
  copy: {
    minHeight: 44,
    minWidth: 44,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: spacing.xs,
  },
  copyText: { ...typography.bodySmall, color: colors.primary, ...typography.semiBold },
}));

export function SupportKcPayeePhone({ phone, testID }: { readonly phone: string; readonly testID?: string }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useStyles();
  const [copied, setCopied] = useState(false);
  const display = formatPayeePhone(phone);

  // Copies the digits-only number so it pastes cleanly into Bit / PayBox.
  const onCopy = useCallback(async () => {
    const outcome = await copyOrShareText(phone);
    setCopied(outcome.kind === 'copied');
  }, [phone]);

  return (
    <View style={styles.row} testID={testID}>
      <Text style={styles.text} selectable>
        {t('supportKc.payeePhone', { phone: display })}
      </Text>
      <Pressable
        style={styles.copy}
        onPress={() => void onCopy()}
        accessibilityRole="button"
        accessibilityLabel={t('supportKc.copyPhoneA11y', { phone: display })}
        testID={testID ? `${testID}-copy` : undefined}
      >
        <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={iconSize.sm} color={colors.primary} />
        <Text style={styles.copyText} accessibilityLiveRegion="polite">
          {copied ? t('supportKc.phoneCopied') : t('supportKc.copyPhone')}
        </Text>
      </Pressable>
    </View>
  );
}
