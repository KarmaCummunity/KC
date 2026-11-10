import React, { useCallback } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';
import { useDetailStackScreenOptions } from '../../src/navigation/detailStackScreenOptions';
import { container } from '../../src/lib/container';
import type { VerificationLevel } from '@kc/domain';
import { AvatarInitials } from '../../src/components/AvatarInitials';
import { VerificationBadge } from '../../src/components/VerificationBadge';
import { rtlTextAlignStart } from '../../src/lib/rtlTextAlignStart';
import { rowDirectionStart } from '../../src/lib/rtlLayout';
import { KcFlashList } from '../../src/components/lists/KcFlashList';
import { SimpleRowListSkeleton } from '../../src/components/skeletons/SimpleRowListSkeleton';

type SuggestionItem = {
  userId: string;
  shareHandle: string;
  displayName: string | null;
  avatarUrl: string | null;
  reason: string;
  verificationLevel?: VerificationLevel;
};

const suggestionKeyExtractor = (item: SuggestionItem) => item.userId;
const SuggestionSeparator = () => <View style={{ height: spacing.sm }} />;
const LIST_CONTENT_STYLE = { padding: spacing.base };

const FollowSuggestionRow = React.memo(function FollowSuggestionRow({
  item,
  reasonLabel,
  onPress,
  styles,
}: {
  item: SuggestionItem;
  reasonLabel: string;
  onPress: (handle: string) => void;
  styles: ReturnType<typeof useStyles>;
}) {
  const handlePress = React.useCallback(() => {
    onPress(item.shareHandle);
  }, [item.shareHandle, onPress]);

  const name = item.displayName ?? item.shareHandle;

  return (
    <Pressable style={styles.row} onPress={handlePress}>
      <AvatarInitials name={name} avatarUrl={item.avatarUrl} size={44} />
      <View style={{ flex: 1 }}>
        <View style={styles.nameRow}>
          <Text style={styles.name}>{name}</Text>
          <VerificationBadge level={item.verificationLevel} />
        </View>
        <Text style={styles.meta}>@{item.shareHandle} · {reasonLabel}</Text>
      </View>
    </Pressable>
  );
});

export default function FollowSuggestionsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const styles = useStyles();
  const detailStackScreenOptions = useDetailStackScreenOptions();

  const handleOpenUser = useCallback(
    (handle: string) => {
      router.push({
        pathname: '/user/[handle]',
        params: { handle },
      });
    },
    [router],
  );

  const query = useQuery({
    queryKey: ['followSuggestions'],
    queryFn: () => container.followSuggestions.listSuggestions(20),
  });

  const completeness = useQuery({
    queryKey: ['profileCompleteness'],
    queryFn: () => container.followSuggestions.getProfileCompleteness(),
  });

  const renderItem = useCallback(
    ({ item }: { item: SuggestionItem }) => (
      <FollowSuggestionRow
        item={item}
        reasonLabel={t(`follow.reason.${item.reason}`)}
        onPress={handleOpenUser}
        styles={styles}
      />
    ),
    [handleOpenUser, styles, t],
  );

  return (
    <>
      <Stack.Screen
        options={{
          ...detailStackScreenOptions,
          headerTitle: t('follow.suggestionsTitle'),
          ...(Platform.OS === 'ios' ? { headerLargeTitle: true } : {}),
        }}
      />
      {completeness.data && completeness.data.score < 100 ? (
        <View style={styles.nudge}>
          <Text style={styles.nudgeTitle}>{t('follow.profileNudgeTitle')}</Text>
          <Text style={styles.nudgeBody}>
            {t('follow.profileNudgeBody', { score: completeness.data.score })}
          </Text>
          {completeness.data.showVerifiedBadge ? (
            <Text style={styles.verifiedBadge}>{t('follow.verifiedBadge')}</Text>
          ) : null}
        </View>
      ) : null}
      {query.isLoading && !query.data ? (
        <SimpleRowListSkeleton rows={6} rowHeight={64} />
      ) : (
        <KcFlashList
          data={(query.data as SuggestionItem[] | undefined) ?? []}
          keyExtractor={suggestionKeyExtractor}
          estimatedItemSize={64}
          contentContainerStyle={LIST_CONTENT_STYLE}
          ItemSeparatorComponent={SuggestionSeparator}
          renderItem={renderItem}
          ListEmptyComponent={
            <Text style={styles.empty}>{t('follow.suggestionsEmpty')}</Text>
          }
        />
      )}
    </>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  nudge: {
    margin: spacing.base,
    padding: spacing.base,
    borderRadius: radius.md,
    backgroundColor: colors.primaryLight,
    gap: spacing.xs,
  },
  nudgeTitle: { ...typography.label, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  nudgeBody: { ...typography.body, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  verifiedBadge: { ...typography.caption, color: colors.primary, textAlign: rtlTextAlignStart },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  nameRow: { flexDirection: rowDirectionStart, alignItems: 'center', gap: spacing.xs },
  name: { ...typography.body, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  meta: { ...typography.caption, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  empty: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xl },
}));