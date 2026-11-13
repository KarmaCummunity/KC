// FR-MOD-010 AC4 — sign-in + periodic mid-session enforcement + fetch-level ban detection +
// the server's `account_changed` push on the member's private account topic.
// D61: suspended users stay signed in (SuspensionBanner + support chat); banned users are signed out.
// FR-AUTH-016: a user who deleted the account stays signed in and is sent once to the restore screen.
import { useEffect, useRef } from 'react';
import { useRouter, type Href } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { container } from '../lib/container';
import { useAuthStore } from '../store/authStore';
import { setOnForbiddenCallback } from '@kc/infrastructure-supabase';
import { performFullSignOut } from '../services/performFullSignOut';
import { accountGateDecision } from '../lib/moderation/accountGateDecision';
import { reportAuthEvent } from '../lib/observability/reportAuthEvent';
import { useSuspensionStore } from '../store/suspensionStore';
import { getUserRealtime } from '../services/userRealtimeComposition';

const RECHECK_MS = 60_000;

export function useEnforceAccountGate(userId: string | null) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const signOutLocal = useAuthStore((s) => s.signOut);
  const enforcingRef = useRef(false);
  // True while the user is parked on the restore screen, so the periodic check does not re-route them.
  const restoreRoutedRef = useRef(false);

  useEffect(() => {
    if (!userId) {
      enforcingRef.current = false;
      restoreRoutedRef.current = false;
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
        if (decision.action === 'restore') {
          useSuspensionStore.getState().setSuspension(null);
          if (restoreRoutedRef.current) return;
          restoreRoutedRef.current = true;
          router.replace({
            pathname: '/restore-account',
            params: { until: decision.purgeAt ?? '' },
          } as unknown as Href);
          return;
        }
        restoreRoutedRef.current = false;
        if (decision.action === 'allow' || decision.action === 'suspended') {
          useSuspensionStore.getState().setSuspension(
            decision.action === 'suspended' ? { reason: decision.reason, until: decision.until } : null,
          );
          return;
        }
        enforcingRef.current = true;
        useSuspensionStore.getState().setSuspension(null);
        // The member is about to be signed out by the account gate: record why.
        reportAuthEvent(decision.action === 'reverify' ? 'gate_reverify' : 'gate_blocked', {
          account_status: decision.action === 'blocked' ? decision.reason : 'pending_verification',
        });
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
      } catch (err) {
        // Best-effort — the next interval tick retries. Non-network failures are reported:
        // a gate that keeps failing for a real reason is invisible otherwise.
        reportAuthEvent('gate_check_failed', {}, err);
      }
    };

    setOnForbiddenCallback(() => { void check(); });

    void check();
    const id = setInterval(() => void check(), RECHECK_MS);
    // The server pushes a suspension, ban, lift, deletion or restore at once; the gate is re-read
    // (`bootstrap_session`) on the event. A dropped channel falls back to the periodic check above.
    const unsubscribeAccount = getUserRealtime().subscribeToAccount(userId, () => {
      void queryClient.invalidateQueries({ queryKey: ['user-profile', userId] });
      void check();
    });

    return () => {
      cancelled = true;
      clearInterval(id);
      unsubscribeAccount();
      setOnForbiddenCallback(null);
    };
  }, [userId, signOutLocal, router, queryClient]);
}
