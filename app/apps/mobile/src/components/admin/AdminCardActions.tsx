import { View } from 'react-native';
import { makeUseStyles, spacing } from '@kc/ui';
import { DangerButton, PrimaryButton } from '../ui/Buttons';

export interface AdminCardActionsProps {
  readonly editLabel:   string;
  readonly deleteLabel: string;
  readonly onEdit:      () => void;
  readonly onDelete:    () => void;
}

export function AdminCardActions({ editLabel, deleteLabel, onEdit, onDelete }: AdminCardActionsProps) {
  const styles = useStyles();
  return (
    <View style={styles.row}>
      {/* Compact admin size (spec 17 §4.3); the delete is destructive, so a DangerButton (D94). */}
      <PrimaryButton label={editLabel} size="sm" onPress={onEdit} />
      <DangerButton label={deleteLabel} size="sm" onPress={onDelete} />
    </View>
  );
}

const useStyles = makeUseStyles(() => ({
  row:                { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
}));
