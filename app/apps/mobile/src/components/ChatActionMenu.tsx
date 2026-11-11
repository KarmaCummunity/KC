// FR-CHAT-010 — bottom-sheet menu shown from the chat header overflow icon.
// Replaces the previous Alert.alert action picker, which RN-Web collapses into
// a plain window.alert (silently dropping the buttons[]) — making the menu
// unreachable in the browser. The frame is the kit `ActionMenuSheet` (spec 17 §4.1).
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ActionMenuSheet } from './ui/ActionMenuSheet';
import { SheetActionRow } from './ui/SheetActionRow';
import { runAfterBottomSheetDismiss } from '../lib/runAfterBottomSheetDismiss';

interface Props {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onReport: () => void;
  readonly deleteLabel?: string;
  readonly onDeleteFromInbox?: () => void;
  /** FR-MOD-003 AC1 — block the counterpart from the conversation; absent for the support thread. */
  readonly blockLabel?: string;
  readonly onBlock?: () => void;
}

export function ChatActionMenu({ visible, onClose, onReport, deleteLabel, onDeleteFromInbox, blockLabel, onBlock }: Props) {
  const { t } = useTranslation();
  return (
    <ActionMenuSheet visible={visible} onDismiss={onClose} cancelLabel={t('general.cancel')}>
      {onDeleteFromInbox && deleteLabel ? (
        <SheetActionRow
          label={deleteLabel}
          destructive
          onPress={() => {
            onClose();
            onDeleteFromInbox();
          }}
        />
      ) : null}
      <SheetActionRow label={t('chat.menuReport')} onPress={onReport} />
      {onBlock && blockLabel ? (
        <SheetActionRow
          label={blockLabel}
          destructive
          testID="chat-menu-block"
          onPress={() => {
            onClose();
            // #2062: iOS drops the confirmation Alert while the sheet is still closing.
            runAfterBottomSheetDismiss(onBlock);
          }}
        />
      ) : null}
    </ActionMenuSheet>
  );
}
