// FR-MOD-007 + FR-ADMIN-004 — overflow ⋮ menu in the user profile header.
// Owns the trigger, action sheet, and the report/ban sheets so the
// /user/[handle] screen stays under the 200-line cap.
//
// TD-127 + TD-138: the previous version used `Alert.alert('', '', buttons)`
// which RN-Web collapses to `window.alert`, dropping the buttons array — so
// the menu was unreachable in the browser. The menu is the kit
// `ActionMenuSheet` (spec 17 §4.1), so it renders identically on iOS, Android
// and Web.
import React, { useState } from 'react';
import { hasPermission, type AdminRole } from '@kc/domain';
import { useAdminRoles } from '../../hooks/useAdminRoles';
import { useTranslation } from 'react-i18next';
import { ActionMenuSheet } from '../ui/ActionMenuSheet';
import { SheetActionRow } from '../ui/SheetActionRow';
import { OverflowMenuTrigger } from './OverflowMenuTrigger';
import { ReportUserModal } from './ReportUserModal';
import { BanUserModal } from './BanUserModal';
import { useUserBlock } from '../../hooks/useUserBlock';

interface Props {
  targetUserId: string;
}

type OpenModal = 'report' | 'ban' | null;

export function ProfileOverflowMenu({ targetUserId }: Props) {
  const { t } = useTranslation();
  const { roles } = useAdminRoles();
  const canBan = hasPermission(roles as readonly AdminRole[], 'reports.permanent_ban');
  const block = useUserBlock(targetUserId);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [openModal, setOpenModal] = useState<OpenModal>(null);

  const close = () => setSheetOpen(false);
  const pick = (m: OpenModal) => {
    setSheetOpen(false);
    setOpenModal(m);
  };

  return (
    <>
      <OverflowMenuTrigger onPress={() => setSheetOpen(true)} accessibilityLabel={t('moderation.report.user.title')} />

      <ActionMenuSheet visible={sheetOpen} onDismiss={close} cancelLabel={t('moderation.actions.cancel')}>
        <SheetActionRow label={t('moderation.report.user.title')} onPress={() => pick('report')} />
        {block.canBlock ? (
          <SheetActionRow
            label={t(block.isBlocked ? 'moderation.block.unblock' : 'moderation.block.block')}
            // Blocking is destructive; unblocking is not.
            destructive={!block.isBlocked}
            disabled={block.busy}
            testID="profile-block-toggle"
            onPress={() => {
              close();
              void block.toggle();
            }}
          />
        ) : null}
        {canBan ? <SheetActionRow label={t('moderation.actions.ban')} destructive onPress={() => pick('ban')} /> : null}
      </ActionMenuSheet>

      <ReportUserModal
        targetUserId={targetUserId}
        visible={openModal === 'report'}
        onClose={() => setOpenModal(null)}
      />
      {canBan ? (
        <BanUserModal
          targetUserId={targetUserId}
          visible={openModal === 'ban'}
          onClose={() => setOpenModal(null)}
        />
      ) : null}
    </>
  );
}
