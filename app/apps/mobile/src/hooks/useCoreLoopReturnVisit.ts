import { useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { trackReturnVisitIfReturning } from '../lib/analyticsCoreLoop';

/** Emits `return_visit` for authenticated users after the first app open (#1055). */
export function useCoreLoopReturnVisit(): void {
  const userId = useAuthStore((s) => s.session?.userId ?? null);

  useEffect(() => {
    if (!userId) return;
    void trackReturnVisitIfReturning({});
  }, [userId]);
}
