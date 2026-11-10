// app/apps/mobile/app/settings/blocked-users.tsx
// FR-MOD-004 AC1 — every member the signed-in user has blocked, with avatar, name and an
// "Unblock" button. Blocked members' profiles are hidden from the blocker (FR-MOD-009), so
// this list is the only way back; it reads list_my_blocked_users (0545).

import React, { useCallback } from 'react';
import { ActivityIndicator, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, radius, spacing, typography, useTheme, Text } from '@kc/ui';
import type { BlockedUser } from '@kc/application';
import { useShellStackScreenOptions } from '../../src/navigation/shellStackScreenOptions';
import { AvatarInitials } from '../../src/components/AvatarInitials';
import { KcFlashList } from '../../src/components/lists/KcFlashList';
import { useBlockedUsers } from '../../src/hooks/useBlockedUsers';
import { rtlTextAlignStart } from '../../src/lib/rtlTextAlignStart';
import { webTextRtl, webViewRtl } from '../../src/lib/webRtlStyle';
export { RouteErrorBoundary as ErrorBoundary } from '../../src/components/RouteErrorBoundary';

const blockedKeyExtractor = (u: BlockedUser) => u.userId;

const BlockedUserRow = React.memo(function BlockedUserRow({
  user,
  fallbackName,
  unblockLabel,
  busy,
  onUnblock,
  styles,
}: {
  user: BlockedUser;
  fallbackName: string;
  unblockLabel: string;
  busy: boolean;
  onUnblock: (user: BlockedUser) => void;
  styles: ReturnType<typeof useBlockedUsersStyles>;
}) {
  const handleUnblock = useCallback(() => onUnblock(user), [onUnblock, user]);
  const name = user.displayName ?? fallbackName;
  return (
    <View style={styles.row} testID={`blocked-user-row-${user.userId}`}>
      <AvatarInitials name={name} avatarUrl={user.avatarUrl} size={44} />
      <Text style={styles.name} numberOfLines={1}>
        {name}
      </Text>
      <TouchableOpacity
        style={styles.btnUnblock}
        disabled={busy}
        onPress={handleUnblock}
        testID={`blocked-user-unblock-${user.userId}`}
        accessibilityRole="button"
      >
        <Text style={styles.btnUnblockText}>{unblockLabel}</Text>
      </TouchableOpacity>
    </View>
  );
});

export default function BlockedUsersScreen() {
  const shellStackScreenOptions = useShellStackScreenOptions();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useBlockedUsersStyles();
  const { users, isLoading, isError, busyId, unblock } = useBlockedUsers();
  const handleUnblock = useCallback((user: BlockedUser) => void unblock(user), [unblock]);

  const renderItem = useCallback(
    ({ item }: { item: BlockedUser }) => (
      <BlockedUserRow
        user={item}
        fallbackName={t('moderation.block.unnamedUser')}
        unblockLabel={t('moderation.block.unblock')}
        busy={busyId === item.userId}
        onUnblock={handleUnblock}
        styles={styles}
      />
    ),
    [busyId, handleUnblock, styles, t],
  );

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen options={{ ...shellStackScreenOptions, headerTitle: t('moderation.block.listTitle') }} />
      <Text style={styles.hint}>{t('moderation.block.listHint')}</Text>
      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={styles.loading} />
      ) : (
        <KcFlashList
          data={users}
          keyExtractor={blockedKeyExtractor}
          estimatedItemSize={68}
          contentContainerStyle={styles.list}
          renderItem={renderItem}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {isError ? t('moderation.block.listError') : t('moderation.block.listEmpty')}
            </Text>
          }
        />
      )}
    </SafeAreaView>
  );
}

const useBlockedUsersStyles = makeUseStyles(({ colors }) => ({
  container: { flex: 1, backgroundColor: colors.background, ...webViewRtl },
  hint: {
    ...typography.caption,
    color: colors.textSecondary,
    paddingHorizontal: spacing.base,
    paddingTop: spacing.base,
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
  loading: { marginTop: spacing.lg },
  list: { padding: spacing.base, gap: spacing.sm, ...webViewRtl },
  empty: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    ...webTextRtl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...webViewRtl,
  },
  name: {
    ...typography.body,
    color: colors.textPrimary,
    flex: 1,
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
  btnUnblock: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  btnUnblockText: { ...typography.button, color: colors.textPrimary },
}));
