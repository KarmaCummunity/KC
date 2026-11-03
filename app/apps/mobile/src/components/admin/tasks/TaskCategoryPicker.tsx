// app/apps/mobile/src/components/admin/tasks/TaskCategoryPicker.tsx
// V2-ADMIN-TASKS-2 — single-select radio strip for picking a task category.
import { View } from 'react-native';
import { ADMIN_TASK_CATEGORIES, type AdminTaskCategory } from '@kc/domain';
import { makeUseStyles, spacing } from '@kc/ui';
import { Chip } from '../../ui/Chip';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';

export interface TaskCategoryPickerProps {
  readonly value: AdminTaskCategory;
  readonly onChange: (next: AdminTaskCategory) => void;
  readonly disabled?: boolean;
}

export function TaskCategoryPicker({ value, onChange, disabled = false }: TaskCategoryPickerProps) {
  const styles = useStyles();
  const L = useLocaleBundle();
  return (
    <View style={styles.row} accessibilityRole="radiogroup">
      {ADMIN_TASK_CATEGORIES.map((c) => (
        <Chip
          key={c}
          label={L.admin.tasks.category[c]}
          selected={value === c}
          disabled={disabled}
          onPress={() => onChange(c)}
          size="sm"
        />
      ))}
    </View>
  );
}

const useStyles = makeUseStyles(() => ({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
}));
