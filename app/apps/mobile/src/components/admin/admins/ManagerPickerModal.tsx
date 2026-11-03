// app/apps/mobile/src/components/admin/admins/ManagerPickerModal.tsx
// FR-ADMIN-025 / FR-ADMIN-030 — pick a direct manager for a grant, or detach
// it to a tree root. The caller passes only candidates the viewer may choose
// (GrantAuthority `managerCandidatesFor`, FR-ADMIN-027); the server re-checks.
import React, { useCallback } from 'react';
import { Pressable } from 'react-native';
import type { OrgTreeMember } from '@kc/domain';
import { makeUseStyles, radius, spacing, Text, typography } from '@kc/ui';
import { AvatarInitials } from '../../AvatarInitials';
import { RoleBadge } from './RoleBadge';
import { rowDirectionStart, textAlignStart } from '../../../lib/rtlLayout';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';
import { KcFlashList } from '../../lists/KcFlashList';
import { GhostButton } from '../../ui/Buttons';
import { Modal } from '../../ui/Modal';

export interface ManagerPickerModalProps {
  readonly visible: boolean;
  readonly candidates: readonly OrgTreeMember[];
  readonly busy?: boolean;
  /** Detaching to a root is offered only to the platform super_admin. */
  readonly allowDetach: boolean;
  readonly onPick: (managerGrantId: string | null) => void;
  readonly onClose: () => void;
}

const managerPickerKeyExtractor = (m: OrgTreeMember) => m.grantId;

const ManagerCandidateRow = React.memo(function ManagerCandidateRow({
  item,
  busy,
  unnamedLabel,
  onPick,
  styles,
}: {
  item: OrgTreeMember;
  busy?: boolean;
  unnamedLabel: string;
  onPick: (managerGrantId: string) => void;
  styles: ReturnType<typeof useStyles>;
}) {
  const handlePress = useCallback(() => {
    onPick(item.grantId);
  }, [item.grantId, onPick]);

  const name = item.displayName ?? unnamedLabel;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      onPress={handlePress}
      style={styles.row}
    >
      <AvatarInitials name={name} avatarUrl={item.avatarUrl} size={32} />
      <Text style={styles.name} numberOfLines={1}>
        {name}
      </Text>
      <RoleBadge role={item.role} />
    </Pressable>
  );
});

export function ManagerPickerModal(props: ManagerPickerModalProps) {
  const { visible, candidates, busy, allowDetach, onPick, onClose } = props;
  const styles = useStyles();
  const L = useLocaleBundle();

  const handlePickCandidate = useCallback(
    (managerGrantId: string) => onPick(managerGrantId),
    [onPick],
  );

  const renderItem = useCallback(
    ({ item }: { item: OrgTreeMember }) => (
      <ManagerCandidateRow
        item={item}
        busy={busy}
        unnamedLabel={L.admin.admins.row.unnamed}
        onPick={handlePickCandidate}
        styles={styles}
      />
    ),
    [busy, handlePickCandidate, L.admin.admins.row.unnamed, styles],
  );

  return (
    <Modal
      visible={visible}
      title={L.admin.admins.managerPicker.title}
      onDismiss={onClose}
      // While a pick is saving, keep the picker up (the cancel button below still closes it).
      dismissible={!busy}
      footer={<GhostButton label={L.admin.admins.managerPicker.cancel} size="md" fullWidth onPress={onClose} />}
    >
      <Text style={styles.hint}>{L.admin.admins.managerPicker.hint}</Text>

      {allowDetach && (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => onPick(null)}
          style={styles.detach}
        >
          <Text style={styles.detachText}>{L.admin.admins.managerPicker.detach}</Text>
        </Pressable>
      )}

      <KcFlashList
        data={candidates}
        keyExtractor={managerPickerKeyExtractor}
        estimatedItemSize={48}
        style={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>{L.admin.admins.managerPicker.empty}</Text>
        }
        renderItem={renderItem}
      />
    </Modal>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  hint:  { ...typography.caption, color: colors.textSecondary, textAlign: textAlignStart() },
  detach: {
    paddingVertical: spacing.md, paddingHorizontal: spacing.md, borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  detachText: { ...typography.bodySmall, ...typography.bold, color: colors.primary, textAlign: textAlignStart() },
  // Hug a short list; shrink inside the dialog's height cap so a long one scrolls above the pinned cancel.
  list: { flexGrow: 0, flexShrink: 1 },
  row: {
    flexDirection: rowDirectionStart, alignItems: 'center', gap: spacing.md,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.xs,
  },
  name: { ...typography.body, ...typography.semiBold, flex: 1, color: colors.textPrimary, textAlign: textAlignStart() },
  empty: { ...typography.bodySmall, color: colors.textSecondary, textAlign: 'center', padding: spacing.base },
}));
