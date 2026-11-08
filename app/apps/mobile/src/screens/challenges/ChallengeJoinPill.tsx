// Compact "Join" pill for an active challenge the viewer hasn't joined (docs/spec/10_challenges.md).
import React from 'react';
import { ActivityIndicator, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { iconSize, useTheme, Text } from '@kc/ui';
import { usePostDetailStyles } from '../post/postDetailScreen.styles';

type Props = Readonly<{
  busy: boolean;
  onPress: () => void;
}>;

export function ChallengeJoinPill({ busy, onPress }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = usePostDetailStyles();
  return (
    <TouchableOpacity
      style={styles.messageBtn}
      activeOpacity={0.85}
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityState={{ busy }}
      accessibilityLabel={t('challenges.detail.join')}
      testID="challenge-join-floating"
    >
      {busy ? (
        <ActivityIndicator size="small" color={colors.textInverse} />
      ) : (
        <>
          <Ionicons name="add-circle-outline" size={iconSize.md} color={colors.textInverse} />
          <Text style={styles.messageBtnText}>{t('challenges.detail.join')}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}
