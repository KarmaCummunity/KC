// Status chip section for admin user/post search filter sheets (FR-ADMIN-019).
import type { ReactNode } from 'react';
import { FilterSection, type FilterOption } from '../../filterKit/FilterSection';

const ALL_TOKEN = '__all__';

export function adminStatusChipValue(current: string | null): string {
  return current ?? ALL_TOKEN;
}

export function adminStatusChipOnChange(
  val: string | null,
  onChange: (next: string | null) => void,
): void {
  onChange(val === ALL_TOKEN || val === null ? null : val);
}

export function countAdminStatusFilter(status: string | null): number {
  return status ? 1 : 0;
}

export function AdminContentStatusFilterSection({
  title,
  options,
  value,
  onChange,
}: Readonly<{
  title?: string;
  options: readonly FilterOption<string>[];
  value: string | null;
  onChange: (next: string | null) => void;
}>): ReactNode {
  return (
    <FilterSection<string>
      title={title}
      options={options}
      value={adminStatusChipValue(value)}
      onChange={(val) => adminStatusChipOnChange(val, onChange)}
    />
  );
}
