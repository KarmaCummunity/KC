// FR-MOD-010 AC4 — sign-in + periodic mid-session enforcement + fetch-level ban detection.
// D61: suspended users stay signed in (SuspensionBanner + support chat); banned users are signed out.
import { useEffect, useRef } from 'react';
import { useRouter, type Href } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { container } from '../lib/container';
import { useAuthStore } from '../store/authStore';
import { setOnForbiddenCallback } from '@kc/infrastructure-supabase';
import { performFullSignOut } from '../services/performFullSignOut';
import { accountGateDecision } from '../lib/moderation/accountGateDecision';
import { useSuspensionStore } from '../store/suspensionStore';

const RECHECK_MS = 60_000;

export function useEnforceAccountGate(userId: string | null) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const signOutLocal = useAuthStore((s) => s.signOut);
  const enforcingRef = useRef(false);

  useEffect(() => {
    if (!userId) {
      enforcingRef.current = false;
      useSuspensionStore.getState().setSuspension(null);
      setOnForbiddenCallback(null);
      return;
    }

    let cancelled = false;

    const check = async () => {
      if (cancelled || enforcingRef.current) return;
      try {
        const decision = accountGateDecision(await container.checkAccountGate.execute({ userId }));
        if (cancelled) return;
        if (decision.action === 'allow' || decision.action === 'suspended') {
          useSuspensionStore.getState().setSuspension(
            decision.action === 'suspended' ? { reason: decision.reason, until: decision.until } : null,
          );
          return;
        }
        enforcingRef.current = true;
        useSuspensionStore.getState().setSuspension(null);
        if (decision.action === 'reverify') {
          await performFullSignOut({
            deviceRepo: container.deviceRepo,
            queryClient,
            signOutLocal,
          });
          router.replace('/(auth)/sign-in');
          return;
        }
        await performFullSignOut({
          deviceRepo: container.deviceRepo,
          queryClient,
          signOutLocal,
        });
        router.replace({
          pathname: '/account-blocked',
          params: {
            reason: decision.reason,
            until: decision.until ?? '',
          },
        } as unknown as Href);
      } catch {
        // Network failure is best-effort — the next interval tick retries.
      }
    };

    setOnForbiddenCallback(() => { void check(); });

    void check();
    const id = setInterval(() => void check(), RECHECK_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
      setOnForbiddenCallback(null);
    };
  }, [userId, signOutLocal, router, queryClient]);
}
