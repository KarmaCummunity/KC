// app/apps/mobile/src/hooks/useAdminSurveys.ts
// FR-ADMIN-021 — admin survey dashboard queries (overview, results, PMF report, feedback).
import { useQuery } from '@tanstack/react-query';
import type {
  AdminSurveyOverviewItem,
  AdminSurveyResults,
  AdminFeedbackEntry,
} from '@kc/domain';
import type { PmfSurveyReportView } from '@kc/application';
import { container } from '../lib/container';

const EMPTY_OVERVIEW: readonly AdminSurveyOverviewItem[] = [];
const EMPTY_FEEDBACK: readonly AdminFeedbackEntry[] = [];

export function useAdminSurveyOverview(enabled = true) {
  const q = useQuery({
    queryKey: ['admin.surveys.overview'],
    queryFn: () => container.getAdminSurveyOverview.execute(),
    enabled,
    staleTime: 30_000,
  });
  return {
    surveys: q.data ?? EMPTY_OVERVIEW,
    isLoading: q.isLoading,
    isRefetching: q.isRefetching,
    refetch: () => { void q.refetch(); },
    error: q.error,
  };
}

export function useAdminSurveyResults(slug: string | null | undefined) {
  const q = useQuery<AdminSurveyResults | null>({
    queryKey: ['admin.surveys.results', slug ?? ''],
    queryFn: () => container.getAdminSurveyResults.execute(slug ?? ''),
    enabled: Boolean(slug),
    staleTime: 30_000,
  });
  return {
    results: q.data ?? null,
    isLoading: q.isLoading,
    isRefetching: q.isRefetching,
    refetch: () => { void q.refetch(); },
    error: q.error,
  };
}

/** Sean Ellis PMF counts + derived score for one survey (KC#1058). */
export function useAdminPmfReport(slug: string | null | undefined) {
  const q = useQuery<PmfSurveyReportView>({
    queryKey: ['admin.surveys.pmf', slug ?? ''],
    queryFn: () => container.getPmfSurveyReport.execute(slug ?? undefined),
    enabled: Boolean(slug),
    staleTime: 30_000,
  });
  return {
    view: q.data ?? null,
    isLoading: q.isLoading,
    isRefetching: q.isRefetching,
    refetch: () => { void q.refetch(); },
    error: q.error,
  };
}

export function useAdminUserFeedback(enabled = true) {
  const q = useQuery({
    queryKey: ['admin.surveys.feedback'],
    queryFn: () => container.listUserFeedback.execute({ limit: 100, offset: 0 }),
    enabled,
    staleTime: 30_000,
  });
  return {
    feedback: q.data ?? EMPTY_FEEDBACK,
    isLoading: q.isLoading,
    isRefetching: q.isRefetching,
    refetch: () => { void q.refetch(); },
    error: q.error,
  };
}
