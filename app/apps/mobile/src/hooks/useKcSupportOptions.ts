import { useQuery } from '@tanstack/react-query';
import { paymentsUseCases } from '../services/paymentsComposition';

/** FR-DONATE-011 — donor-facing channels for supporting KC (server config, compiled fallback). */
export function useKcSupportOptions() {
  return useQuery({
    queryKey: ['money', 'kc-support-options'],
    queryFn: () => paymentsUseCases.kcSupportOptions().execute(),
    staleTime: 5 * 60_000,
  });
}
