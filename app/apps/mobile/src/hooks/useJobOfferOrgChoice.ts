// Mapped to spec: docs/spec/05_giving_worlds.md §5.11 (#1476) — the organization a job offer is
// published for. Only the member's organizations that may post jobs are offered; the
// memberships load with the event form's query (shared key), once per session.
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  isJobOffer,
  jobOfferOrganizations,
  preselectedJobOfferOrgId,
  type JobOfferOrgState,
} from '../lib/unifiedCreate/jobOfferOrg';
import { eventRegistrationUseCases, MY_ORGANIZATIONS_QUERY_KEY } from '../services/eventRegistrationComposition';
import { useAuthStore } from '../store/authStore';

export interface JobOfferOrgChoice extends JobOfferOrgState {
  readonly setOrgId: (orgId: string) => void;
}

export function useJobOfferOrgChoice(worldSlug: string, kindSlug: string | null | undefined): JobOfferOrgChoice {
  const userId = useAuthStore((s) => s.session?.userId ?? null);
  const required = isJobOffer(worldSlug, kindSlug);
  const organizationsQuery = useQuery({
    queryKey: MY_ORGANIZATIONS_QUERY_KEY,
    queryFn: () => eventRegistrationUseCases.listMyOrganizations().execute(),
    enabled: required && userId !== null,
    staleTime: 5 * 60_000, // memberships change rarely
  });
  const [pickedOrgId, setOrgId] = useState<string | null>(null);
  const organizations = useMemo(() => jobOfferOrganizations(organizationsQuery.data ?? []), [organizationsQuery.data]);
  return {
    required,
    // A failed load counts as loaded with no organization: the member sees why they cannot offer a job.
    loaded: organizationsQuery.isSuccess || organizationsQuery.isError,
    organizations,
    orgId: pickedOrgId ?? preselectedJobOfferOrgId(organizations),
    setOrgId,
  };
}
