// FR-DONATE-011 — the payment choices inside the "support KC" card:
// one-time channels (Bit / PayBox / card page) and the monthly standing order.
import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, useTheme, Text } from '@kc/ui';
import { hasKcSupportOptions, type KcSupportChannel, type KcSupportOptions as Options } from '@kc/domain';
import { PrimaryButton, SecondaryButton } from '../ui/Buttons';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

interface SupportKcOptionsProps {
  readonly options: Options | undefined;
  readonly loading: boolean;
  readonly onOpen: (url: string) => void;
}

const useStyles = makeUseStyles(({ colors }) => ({
  group: { gap: spacing.sm, marginTop: spacing.sm },
  heading: { ...typography.h4, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  body: { ...typography.body, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  status: { ...typography.bodySmall, color: colors.textSecondary, textAlign: 'center' as const },
}));

/** One channel button; the first one-time channel is the visually primary action. */
function ChannelButton({
  channel,
  primary,
  onOpen,
}: {
  readonly channel: KcSupportChannel;
  readonly primary: boolean;
  readonly onOpen: (url: string) => void;
}) {
  const { t } = useTranslation();
  const label = t(`supportKc.channel.${channel.kind}`);
  const Button = primary ? PrimaryButton : SecondaryButton;
  return (
    <Button
      label={label}
      icon="open-outline"
      onPress={() => onOpen(channel.url)}
      accessibilityLabel={t('supportKc.channelA11y', { label, provider: channel.providerLabel })}
      testID={`support-kc-${channel.kind}`}
      fullWidth
    />
  );
}

export function SupportKcOptions({ options, loading, onOpen }: SupportKcOptionsProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useStyles();

  if (loading) {
    return (
      <View style={styles.group} accessibilityLabel={t('supportKc.loading')}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!options || !hasKcSupportOptions(options)) {
    return <Text style={styles.status}>{t('supportKc.unavailable')}</Text>;
  }

  const { oneTime, standingOrder } = options;
  return (
    <>
      {oneTime.length > 0 ? (
        <View style={styles.group}>
          <Text style={styles.heading} accessibilityRole="header">{t('supportKc.oneTimeHeading')}</Text>
          {oneTime.map((channel, index) => (
            <ChannelButton key={channel.kind} channel={channel} primary={index === 0} onOpen={onOpen} />
          ))}
        </View>
      ) : null}
      {standingOrder ? (
        <View style={styles.group}>
          <Text style={styles.heading} accessibilityRole="header">{t('supportKc.standingOrderHeading')}</Text>
          <Text style={styles.body}>
            {t('supportKc.standingOrderBody', { provider: standingOrder.providerLabel })}
          </Text>
          <ChannelButton channel={standingOrder} primary={oneTime.length === 0} onOpen={onOpen} />
        </View>
      ) : null}
    </>
  );
}
