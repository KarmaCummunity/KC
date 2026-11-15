// app/apps/mobile/src/components/profile/MyProfileChrome.tsx
// Chrome of the My Profile screen (`/profile`): TopBar + profile card (⋮ menu: web uses
// `right` when `dir=rtl` / `I18nManager.isRTL`; native uses `start`) + open / closed tabs.
// The tabs are controlled by the screen: switching swaps only the posts list below, so
// this chrome stays mounted and its entry animations never replay (#1633).
// Mapped to: FR-PROFILE-001 AC1, AC4.
import React from 'react';
import {
  ActivityIndicator,
  I18nManager,
  Platform,
  StyleSheet,
  TouchableOpacity,
  View,
  type ViewStyle,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, radius, spacing, typography, iconSize, zIndex, useTheme, Text } from '@kc/ui';
import { MirroredIcon } from '../ui/MirroredIcon';
import { TopBar } from '../TopBar';
import { ProfileHeader } from './ProfileHeader';
import { ProfileStatsRow } from './ProfileStatsRow';
import { ProfileTabs, type ProfilePostsTab } from './ProfileTabs';
import { MyProfileOverflowMenu } from './MyProfileOverflowMenu';
import { Card } from '../ui/Card';
import { MotionEntry, ENTRY_DELAY } from '../ui/MotionEntry';
import { useAuthStore } from '../../store/authStore';
import { getUserRepo } from '../../services/userComposition';
import { useProfileTabCounts } from '../../hooks/useProfileTabCounts';
import { isOwnProfileIncomplete } from '../../hooks/useOwnProfileIncomplete';
import { needsIdentityVerificationReminder } from '../../hooks/useOwnProfileNeedsIdentityVerification';
import { IdentityVerificationProfileCard } from './IdentityVerificationProfileCard';
import { effectiveVerificationLevel } from '@kc/domain';
import { KarmaBadge } from './KarmaBadge';
import { formatUserLocationLine } from '../../lib/formatUserLocationLine';
import { rowDirectionStart } from '../../lib/rtlLayout';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

/**
 * RN-Web: absolute `start` ignores RTL like native. `I18nManager.isRTL` is also false at
 * module load (forceRTL runs in RootLayout `useEffect`), so we must not read RTL once at import.
 * Prefer DOM `dir` (set synchronously in `app/_layout.tsx` for web) then live `I18nManager`.
 */
function profileMenuCornerHorizontalInset(): Pick<ViewStyle, 'left' | 'right' | 'start'> {
  if (Platform.OS !== 'web') return { start: spacing.sm };
  const docRtl =
    typeof document !== 'undefined' &&
    (document.documentElement.dir === 'rtl' ||
      document.documentElement.getAttribute('dir') === 'rtl');
  const rtl = docRtl || I18nManager.isRTL;
  return rtl ? { right: spacing.sm } : { left: spacing.sm };
}

export interface MyProfileChromeProps {
  /** Posts lane highlighted in the tab strip. */
  activeTab: ProfilePostsTab;
  /** Called with the lane the member taps; the screen owns the tab state. */
  onTabChange: (tab: ProfilePostsTab) => void;
}

export function MyProfileChrome({ activeTab, onTabChange }: Readonly<MyProfileChromeProps>) {
  const styles = useMyProfileChromeStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const session = useAuthStore((s) => s.session);
  const userId = session?.userId;
  const fallbackName = t('profile.fallbackName');

  const userQuery = useQuery({
    queryKey: ['user-profile', userId],
    queryFn: () => getUserRepo().findById(userId!),
    enabled: Boolean(userId),
    staleTime: 5 * 60_000, // PERF-3: profile (self) — edit-profile invalidates explicitly
  });
  const user = userQuery.data ?? null;
  const tabCounts = useProfileTabCounts({
    profileUserId: userId,
    viewerUserId: userId ?? null,
    enabled: Boolean(userId),
  });
  const profileLoading = userQuery.isLoading && user === null;
  const displayName = user?.displayName?.trim() || fallbackName;
  const avatarUrl = user?.avatarUrl ?? null;
  const biography = user?.biography ?? null;
  const profileIncomplete = isOwnProfileIncomplete(user);
  const identityNudge = needsIdentityVerificationReminder(user);
  const verificationLevel = user ? effectiveVerificationLevel(user) : undefined;

  return (
    <>
      <TopBar />
      <MotionEntry variant="hero" delay={ENTRY_DELAY.hero}>
        <View style={styles.profileOuter}>
          <View
            style={[styles.profileMenuCorner, profileMenuCornerHorizontalInset()]}
            pointerEvents="box-none"
          >
            <MyProfileOverflowMenu
              showFollowRequests={user?.privacyMode === 'Private'}
              profileShare={user ? { shareHandle: user.shareHandle, displayName: user.displayName } : undefined}
            />
          </View>
          <Card padding="base" style={styles.profileCard}>
            {profileLoading ? (
              <View style={styles.profileLoading}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : (
              <>
                <ProfileHeader
                  displayName={displayName}
                  locationLine={user ? formatUserLocationLine(user) : null}
                  avatarUrl={avatarUrl}
                  biography={biography}
                  privacyMode={user?.privacyMode ?? 'Public'}
                  onLockPress={() => router.push('/settings')}
                  size={72}
                  verificationLevel={verificationLevel}
                  onIncompleteAvatarPress={profileIncomplete ? () => router.push('/edit-profile') : undefined}
                />
                <ProfileStatsRow
                  followersCount={user?.followersCount ?? 0}
                  followingCount={user?.followingCount ?? 0}
                  postsCount={tabCounts.totalCount ?? 0}
                  enabled={Boolean(user)}
                  onPressFollowers={() =>
                    router.push({
                      pathname: '/user/[handle]/followers',
                      params: { handle: user?.shareHandle ?? '' },
                    })
                  }
                  onPressFollowing={() =>
                    router.push({
                      pathname: '/user/[handle]/following',
                      params: { handle: user?.shareHandle ?? '' },
                    })
                  }
                />
                {user ? <KarmaBadge points={user.karmaPoints} /> : null}
                {identityNudge ? <IdentityVerificationProfileCard /> : null}
              </>
            )}
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[styles.editBtn, profileIncomplete && styles.completeBtn]}
                onPress={() => router.push('/edit-profile')}
                testID={profileIncomplete ? 'profile-complete-btn' : 'profile-edit-btn'}
              >
                <Text style={[styles.editBtnText, profileIncomplete && styles.completeBtnText]}>
                  {profileIncomplete ? t('verification.nudge.cta') : t('profile.editProfile')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.shareBtn}>
                <Ionicons name="share-outline" size={iconSize.md} color={colors.primary} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.statsLink}
              onPress={() => router.push('/stats')}
              accessibilityRole="button"
              accessibilityLabel={t('settings.stats')}
            >
              <Ionicons name="stats-chart-outline" size={iconSize.lg} color={colors.primary} />
              <Text style={styles.statsLinkText}>{t('settings.stats')}</Text>
              <MirroredIcon name="chevron-forward" size={iconSize.md} color={colors.textSecondary} />
            </TouchableOpacity>
          </Card>
        </View>
      </MotionEntry>
      <MotionEntry variant="bottom" delay={ENTRY_DELAY.section}>
        <ProfileTabs
          active={activeTab}
          onChange={(next) => {
            if (next !== activeTab) onTabChange(next);
          }}
          openCount={tabCounts.openCount}
          closedCount={tabCounts.closedCount}
        />
      </MotionEntry>
    </>
  );
}

const useMyProfileChromeStyles = makeUseStyles(({ colors }) => ({
  profileOuter: {
    margin: spacing.base,
    position: 'relative' as const,
  },
  profileMenuCorner: {
    position: 'absolute' as const,
    top: spacing.sm,
    zIndex: zIndex.overlay,
  },
  profileCard: { gap: spacing.base },
  profileLoading: {
    minHeight: 120,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  actionRow: { flexDirection: 'row' as const, gap: spacing.sm },
  editBtn: {
    flex: 1,
    height: 44,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  editBtnText: { ...typography.button, color: colors.textPrimary },
  completeBtn: { backgroundColor: colors.primary, borderColor: colors.primary },
  completeBtnText: { color: colors.textInverse },
  shareBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  statsLink: {
    flexDirection: rowDirectionStart,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  statsLinkText: { flex: 1, ...typography.body, color: colors.textPrimary, textAlign: rtlTextAlignStart },
}));
