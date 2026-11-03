// Status tag of an admin task (row + detail): the kit `Chip` tag, toned by status (spec 17 §4.1).
import type { AdminTaskStatus } from '@kc/domain';
import { Chip } from '../../ui/Chip';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';
import { TASK_STATUS_TONE } from './taskTagTones';

export interface TaskStatusChipProps {
  readonly status: AdminTaskStatus;
}

export function TaskStatusChip({ status }: TaskStatusChipProps) {
  const L = useLocaleBundle();
  return <Chip variant="tag" size="sm" tone={TASK_STATUS_TONE[status]} label={L.admin.tasks.status[status]} />;
}
