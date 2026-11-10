// app/apps/mobile/app/settings/follow-requests.tsx
// FR-FOLLOW-007: pending follow-request inbox. Reachable only when Private.

import React, { useCallback } from 'react';
import { ActivityIndicator, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useShellStackScreenOptions } from '../../src/navigation/shellStackScreenOptions';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { makeUseStyles, radius, spacing, typography, useTheme, Text } from '@kc/ui';
import type { FollowRequestWithUser } from '@kc/application';
import { AvatarInitials } from '../../src/components/AvatarInitials';
import { NotifyModal } from '../../src/components/NotifyModal';
import { useAuthStore } from '../../src/store/authStore';
import { getUserRepo } from '../../src/services/userComposition';
import {
  getListPendingFollowRequestsUseCase,
  getAcceptFollowRequestUseCase,
  getRejectFollowRequestUseCase,
} from '../../src/services/followComposition';
import { rtlTextAlignStart } from '../../src/lib/rtlTextAlignStart';
import { webTextRtl, webViewRtl } from '../../src/lib/webRtlStyle';
import { KcFlashList } from '../../src/components/lists/KcFlashList';

const requestKeyExtractor = (r: FollowRequestWithUser) => r.requester.userId;

const FollowRequestRow = React.memo(function FollowRequestRow({
  req,
  fallbackName,
  cityNotSet,
  approveLabel,
  rejectLabel,
  onOpenProfile,
  onResolve,
  styles,
}: {
  req: FollowRequestWithUser;
  fallbackName: string;
  cityNotSet: string;
  approveLabel: string;
  rejectLabel: string;
  onOpenProfile: (handle: string) => void;
  onResolve: (req: FollowRequestWithUser, action: 'accept' | 'reject') => void;
  styles: ReturnType<typeof useFollowRequestsScreenStyles>;
}) {
  const handleOpen = React.useCallback(() => {
    onOpenProfile(req.requester.shareHandle);
  }, [req.requester.shareHandle, onOpenProfile]);

  const handleApprove = React.useCallback(() => {
    onResolve(req, 'accept');
  }, [req, onResolve]);

  const handleReject = React.useCallback(() => {
    onResolve(req, 'reject');
  }, [req, onResolve]);

  const name = req.requester.displayName ?? fallbackName;

  return (
    <View style={styles.row}>
      <TouchableOpacity style={styles.who} onPress={handleOpen}>
        <AvatarInitials name={name} avatarUrl={req.requester.avatarUrl} size={44} />
        <View style={styles.text}>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.city}>{req.requester.cityName ?? cityNotSet}</Text>
        </View>
      </TouchableOpacity>
      <View style={styles.actions}>
        <TouchableOpacity style={styles.btnApprove} onPress={handleApprove}>
          <Text style={styles.btnApproveText}>{approveLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btnReject} onPress={handleReject}>
          <Text style={styles.btnRejectText}>{rejectLabel}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});

export default function FollowRequestsScreen() {
  const shellStackScreenOptions = useShellStackScreenOptions();
  const { t } = useTranslation();
  const router = useRouter();
  const styles = useFollowRequestsScreenStyles();
  const { colors } = useTheme();
  const me = useAuthStore((s) => s.session?.userId);
  const qc = useQueryClient();
  const [errorOpen, setErrorOpen] = React.useState(false);

  const userQuery = useQuery({
    queryKey: ['user-profile', me],
    queryFn: () => getUserRepo().findById(me!),
    enabled: Boolean(me),
    staleTime: 5 * 60_000, // PERF-3: profile (self) — privacy toggle invalidates explicitly
  });
  const isPrivate = userQuery.data?.privacyMode === 'Private';

  const requestsQuery = useQuery({
    queryKey: ['pending-requests', me],
    queryFn: () => getListPendingFollowRequestsUseCase().execute({ targetId: me!, limit: 50 }),
    enabled: Boolean(me && isPrivate),
    staleTime: 5 * 60_000, // PERF-3: follow requests — accept/reject actions invalidate explicitly
  });

  // FR-FOLLOW-007 AC4 — auto-dismiss when toggling to Public.
  React.useEffect(() => {
    if (userQuery.data && !isPrivate) router.back();
  }, [isPrivate, userQuery.data, router]);

  const onResolve = useCallback(
    async (req: FollowRequestWithUser, action: 'accept' | 'reject') => {
      if (!me) return;
      try {
        if (action === 'accept') {
          await getAcceptFollowRequestUseCase().execute({
            sessionUserId: me,
            targetId: me,
            requesterId: req.requester.userId,
          });
        } else {
          await getRejectFollowRequestUseCase().execute({
            targetId: me,
            requesterId: req.requester.userId,
          });
        }
        qc.invalidateQueries({ queryKey: ['pending-requests', me] });
        qc.invalidateQueries({ queryKey: ['pending-requests-count', me] });
        qc.invalidateQueries({ queryKey: ['user-profile', me] });
      } catch {
        setErrorOpen(true);
      }
    },
    [me, qc],
  );

  const handleOpenProfile = useCallback(
    (handle: string) => {
      router.push({
        pathname: '/user/[handle]',
        params: { handle },
      });
    },
    [router],
  );

  const renderItem = useCallback(
    ({ item }: { item: FollowRequestWithUser }) => (
      <FollowRequestRow
        req={item}
        fallbackName={t('profile.fallbackName')}
        cityNotSet={t('profile.cityNotSet')}
        approveLabel={t('settings.followRequestsScreen.approve')}
        rejectLabel={t('settings.followRequestsScreen.reject')}
        onOpenProfile={handleOpenProfile}
        onResolve={onResolve}
        styles={styles}
      />
    ),
    [handleOpenProfile, onResolve, styles, t],
  );

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen
        options={{
          ...shellStackScreenOptions,
          headerTitle: t('settings.followRequestsScreen.headerTitle'),
        }}
      />
      {requestsQuery.isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
      ) : (
        <KcFlashList
          data={requestsQuery.data?.requests ?? []}
          keyExtractor={requestKeyExtractor}
          estimatedItemSize={72}
          contentContainerStyle={styles.list}
          renderItem={renderItem}
          ListEmptyComponent={
            <Text style={styles.empty}>{t('settings.followRequestsScreen.empty')}</Text>
          }
        />
      )}
      <NotifyModal
        visible={errorOpen}
        title={t('settings.followRequestsScreen.errorTitle')}
        message={t('settings.followRequestsScreen.errorMessage')}
        onDismiss={() => setErrorOpen(false)}
      />
    </SafeAreaView>
  );
}

const useFollowRequestsScreenStyles = makeUseStyles(({ colors }) => ({
  container: { flex: 1, backgroundColor: colors.background, ...webViewRtl },
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
  who: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
    ...webViewRtl,
  },
  text: { flex: 1 },
  name: {
    ...typography.body,
    color: colors.textPrimary,
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
  city: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
  actions: { flexDirection: 'row', gap: spacing.xs, ...webViewRtl },
  btnApprove: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  btnApproveText: { ...typography.button, ...typography.bold, color: colors.textInverse },
  btnReject: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  btnRejectText: { ...typography.button, color: colors.textPrimary },
}));
