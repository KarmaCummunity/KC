// FR-VERIFY-003 / FR-VERIFY-005 — the member's identity verification status and starting the provider flow.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { isIdentityVerificationError, type IdentityVerificationErrorCode } from '@kc/domain';
import { useAuthStore } from '../store/authStore';
import { userProfileKeys } from '../lib/queryKeys';
import {
  getIdentityVerificationStatusUseCase,
  getStartIdentityVerificationUseCase,
} from '../services/identityVerificationComposition';

export const identityVerificationKeys = {
  status: (userId: string) => ['identity-verification', userId] as const,
};

/** The signed-in member's verification state; re-read on focus so a finished flow shows at once. */
export function useIdentityVerificationStatus() {
  const userId = useAuthStore((s) => s.session?.userId);
  return useQuery({
    queryKey: identityVerificationKeys.status(userId ?? ''),
    queryFn: () => getIdentityVerificationStatusUseCase().execute(),
    enabled: Boolean(userId),
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });
}

/**
 * Records consent, opens the provider-hosted flow (in-app browser on iOS / Android, a tab on
 * web) and, once the member is back, refreshes the status and the profile badge. The level is
 * set only by the provider's webhook; coming back never sets it (FR-VERIFY-005 AC4).
 */
export function useStartIdentityVerification() {
  const userId = useAuthStore((s) => s.session?.userId) ?? '';
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (consentGiven: boolean) => {
      const session = await getStartIdentityVerificationUseCase().execute({ consentGiven });
      if (Platform.OS === 'web') {
        globalThis.window?.open(session.hostedUrl, '_blank', 'noopener');
      } else {
        // Resolves when the member closes the browser sheet.
        await WebBrowser.openBrowserAsync(session.hostedUrl);
      }
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: identityVerificationKeys.status(userId) }),
        queryClient.invalidateQueries({ queryKey: userProfileKeys.byId(userId) }),
      ]);
    },
  });
  const errorCode: IdentityVerificationErrorCode | null = mutation.error
    ? (isIdentityVerificationError(mutation.error) ? mutation.error.code : 'unavailable')
    : null;
  return { start: mutation.mutate, isStarting: mutation.isPending, errorCode };
}
