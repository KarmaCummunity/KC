// Priority tag of an admin task (row + detail): the kit `Chip` tag, toned by priority (spec 17 §4.1).
import type { AdminTaskPriority } from '@kc/domain';
import { Chip } from '../../ui/Chip';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';
import { TASK_PRIORITY_TONE } from './taskTagTones';

export interface TaskPriorityChipProps {
  readonly priority: AdminTaskPriority;
}

export function TaskPriorityChip({ priority }: TaskPriorityChipProps) {
  const L = useLocaleBundle();
  return <Chip variant="tag" size="sm" tone={TASK_PRIORITY_TONE[priority]} label={L.admin.tasks.priority[priority]} />;
}
