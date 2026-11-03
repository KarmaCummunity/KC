// FR-DONATE-008/009 — web row menu for donation links: RN-Web Alert.alert drops
// multi-button arrays (see ChatActionMenu). The frame is the kit `ActionMenuSheet`.
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { DonationLink } from '@kc/domain';
import { ActionMenuSheet } from './ui/ActionMenuSheet';
import { SheetActionRow } from './ui/SheetActionRow';
import {
  confirmRemoveDonationLink,
  openDonationLinkUrl,
  reportDonationLink,
} from './donationLinkRowHandlers';

interface Props {
  readonly visible: boolean;
  readonly link: DonationLink | null;
  readonly me: string | null;
  readonly isSuperAdmin: boolean;
  readonly onClose: () => void;
  readonly onRemoved: (id: string) => void;
  readonly onEdit: (link: DonationLink) => void;
}

export function DonationLinkRowMenu({
  visible,
  link,
  me,
  isSuperAdmin,
  onClose,
  onRemoved,
  onEdit,
}: Props) {
  const { t } = useTranslation();
  if (!link) return null;

  // The submitter and super admins may edit or remove a link.
  const canManage = link.submittedBy === me || isSuperAdmin;

  const closeThen = (fn: () => void) => {
    onClose();
    fn();
  };

  return (
    <ActionMenuSheet visible={visible} onDismiss={onClose} cancelLabel={t('donations.addLinkModal.cancel')}>
      <SheetActionRow
        label={t('donations.links.rowMenu.open')}
        onPress={() => closeThen(() => openDonationLinkUrl(link))}
      />
      <SheetActionRow
        label={t('donations.links.rowMenu.report')}
        onPress={() => closeThen(() => void reportDonationLink(me, link, t))}
      />
      {canManage ? (
        <SheetActionRow label={t('donations.links.rowMenu.edit')} onPress={() => closeThen(() => onEdit(link))} />
      ) : null}
      {canManage ? (
        <SheetActionRow
          label={t('donations.links.rowMenu.remove')}
          destructive
          onPress={() => closeThen(() => confirmRemoveDonationLink(link, onRemoved, t))}
        />
      ) : null}
    </ActionMenuSheet>
  );
}
