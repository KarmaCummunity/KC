// Category tag of an admin task (row + detail, V2-ADMIN-TASKS-2): the kit `Chip`
// tag with a tone and a leading icon per category (spec 17 §4.1).
import type { AdminTaskCategory } from '@kc/domain';
import { Chip } from '../../ui/Chip';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';
import { TASK_CATEGORY_ICON, TASK_CATEGORY_TONE } from './taskTagTones';

export interface TaskCategoryChipProps {
  readonly category: AdminTaskCategory;
}

export function TaskCategoryChip({ category }: TaskCategoryChipProps) {
  const L = useLocaleBundle();
  return (
    <Chip
      variant="tag"
      size="sm"
      tone={TASK_CATEGORY_TONE[category]}
      icon={TASK_CATEGORY_ICON[category]}
      label={L.admin.tasks.category[category]}
    />
  );
}
