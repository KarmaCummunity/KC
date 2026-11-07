// FR-VERIFY-003 — whether the dev mock IDV RPC is available on this backend.
import { useQuery } from '@tanstack/react-query';
import { devMockIdentityAllowed } from '../services/devIdentityVerification';

export function useDevMockIdentityAllowed() {
  return useQuery({
    queryKey: ['dev-mock-identity-allowed'],
    queryFn: () => devMockIdentityAllowed(),
    staleTime: 60_000,
  });
}
