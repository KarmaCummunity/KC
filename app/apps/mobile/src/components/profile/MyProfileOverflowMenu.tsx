// My Profile — ⋮ overflow anchored to the profile card top-start corner (RTL: visual top-right).
// Routes mirror profile-related rows on `app/settings.tsx` (account, notifications, stats)
// plus admin-removed posts (FR-POST-008 owner list).
// The menu is the kit `ActionMenuSheet`, like ProfileOverflowMenu (RN-Web safe).
import React, { useState } from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActionMenuSheet } from '../ui/ActionMenuSheet';
import { SheetActionRow } from '../ui/SheetActionRow';
import { OverflowMenuTrigger } from './OverflowMenuTrigger';

export function MyProfileOverflowMenu({ showFollowRequests }: Readonly<{ showFollowRequests: boolean }>) {
  const router = useRouter();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  const go = (path: string) => {
    close();
    router.push(path as never);
  };

  return (
    <>
      <OverflowMenuTrigger onPress={() => setOpen(true)} accessibilityLabel={t('profile.myProfileMenuA11y')} />

      <ActionMenuSheet visible={open} onDismiss={close} cancelLabel={t('general.cancel')}>
        <SheetActionRow label={t('settings.accountDetails')} onPress={() => go('/edit-profile')} />
        <SheetActionRow label={t('settings.notifications')} onPress={() => go('/settings/notifications')} />
        {showFollowRequests ? (
          <SheetActionRow label={t('settings.followRequests')} onPress={() => go('/settings/follow-requests')} />
        ) : null}
        <SheetActionRow label={t('settings.stats')} onPress={() => go('/stats')} />
        {/* Managing one's own listings (edit, pause, fulfil) — reached here since the
            marketplace browse screen was removed (FR-DONATE-001 AC6). */}
        <SheetActionRow
          label={t('marketplace.myListingsNav')}
          onPress={() => go('/(tabs)/donations/marketplace/my-listings')}
        />
        <SheetActionRow label={t('profile.myProfileMenuSavedPosts')} onPress={() => go('/(tabs)/profile/saved')} />
        <SheetActionRow label={t('profile.myProfileMenuHiddenPosts')} onPress={() => go('/(tabs)/profile/hidden')} />
        <SheetActionRow label={t('profile.myProfileMenuRemovedPosts')} onPress={() => go('/(tabs)/profile/removed')} />
      </ActionMenuSheet>
    </>
  );
}
