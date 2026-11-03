// Shared frame of the bottom-sheet action menus (spec 17 §4.1, issue #1284): a
// kit `BottomSheet` that lists `SheetActionRow`s, with a ghost cancel button
// pinned in the footer.
//
//   <ActionMenuSheet visible={open} onDismiss={close} cancelLabel={t('general.cancel')}>
//     <SheetActionRow label="Report" onPress={report} />
//     <SheetActionRow label="Block user" destructive onPress={block} />
//   </ActionMenuSheet>
import React, { type ReactNode } from 'react';
import { View } from 'react-native';
import { BottomSheet } from './BottomSheet';
import { GhostButton } from './Buttons';

export interface ActionMenuSheetProps {
  readonly visible: boolean;
  /** Called on backdrop tap, ✕, Android back, web Escape and the cancel button. */
  readonly onDismiss: () => void;
  /** Label of the cancel button pinned in the footer. */
  readonly cancelLabel: string;
  /** Optional heading; a plain action menu has none. */
  readonly title?: string;
  /** The `SheetActionRow`s. */
  readonly children: ReactNode;
}

/** Bottom sheet that lists action rows, with a ghost cancel button in the footer. */
export function ActionMenuSheet({ visible, onDismiss, cancelLabel, title, children }: ActionMenuSheetProps) {
  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      title={title}
      footer={<GhostButton label={cancelLabel} size="md" fullWidth onPress={onDismiss} />}
    >
      {/* One block, so the rows sit flush instead of taking the body's item gap. */}
      <View>{children}</View>
    </BottomSheet>
  );
}
