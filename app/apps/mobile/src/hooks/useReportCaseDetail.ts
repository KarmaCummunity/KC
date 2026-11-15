// app/apps/mobile/src/hooks/useReportCaseDetail.ts
// FR-ADMIN-013 — single-case detail fetch (reporters + timeline + target).
import { useQuery } from '@tanstack/react-query';
import type { AdminReportTargetType } from '@kc/domain';
import { container } from '../lib/container';
import { valueOrNull } from '../lib/backendAvailability';

export function useReportCaseDetail(
  targetType: AdminReportTargetType | null,
  targetId: string | null,
) {
  return useQuery({
    queryKey: ['admin.reports.case', targetType, targetId],
    queryFn: () =>
      // Degrade rule: an unavailable backend reads as "case not found".
      valueOrNull(() => container.getReportCaseDetail.execute(targetType!, targetId!)),
    enabled: targetType !== null && targetId !== null,
    staleTime: 10_000,
  });
}
