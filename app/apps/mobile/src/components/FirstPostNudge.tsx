// FirstPostNudge — the dismissible "share your first post" card at the top
// of the feed. Mapped to FR-FEED-015 (with the three-tier dismissal added in
// P1.2: primary CTA / soft session-dismiss / permanent dismiss link).

import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { Card } from './ui/Card';
import { IconTile } from './ui/IconTile';
import { GhostButton, PrimaryButton, SecondaryButton } from './ui/Buttons';
import { rowDirectionStart } from '../lib/rtlLayout';
import { rtlTextAlignStart } from '../lib/rtlTextAlignStart';

interface FirstPostNudgeProps {
  onShare: () => void;
  onRemindLater: () => void;
  onDismissForever: () => void;
}

export function FirstPostNudge({ onShare, onRemindLater, onDismissForever }: FirstPostNudgeProps) {
  const styles = useFirstPostNudgeStyles();
  const { t } = useTranslation();
  return (
    <View style={styles.outer}>
      <Card padding="base" style={styles.card}>
        <View style={styles.headline}>
          <IconTile icon="gift-outline" size="sm" />
          <Text style={styles.title}>{t('feed.nudgeTitle')}</Text>
        </View>
        <Text style={styles.body}>{t('feed.nudgeBody')}</Text>

        {/* Kit buttons, `md` inside the card; the permanent dismiss is the text link (§8.1 call 5). */}
        <PrimaryButton testID="first-post-nudge-share" label={t('feed.nudgeShare')} size="md" fullWidth onPress={onShare} />
        <SecondaryButton testID="first-post-nudge-remind" label={t('feed.nudgeRemindMe')} size="md" fullWidth onPress={onRemindLater} />
        <View style={styles.link}>
          <GhostButton testID="first-post-nudge-dismiss" label={t('feed.nudgeDontShow')} size="sm" onPress={onDismissForever} />
        </View>
      </Card>
    </View>
  );
}

const useFirstPostNudgeStyles = makeUseStyles(({ colors }) => ({
  outer: { margin: spacing.base },
  card: { gap: spacing.sm },
  headline: { flexDirection: rowDirectionStart, alignItems: 'center' as const, gap: spacing.sm },
  title: { ...typography.h3, color: colors.textPrimary, textAlign: rtlTextAlignStart, flex: 1 },
  body: { ...typography.body, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  link: { alignSelf: 'center' as const },
}));
