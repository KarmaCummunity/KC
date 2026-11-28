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

/** What the member sees when the provider page could not be opened in a new tab (web only). */
export type IdentityStartErrorCode = IdentityVerificationErrorCode | 'popup_blocked';

class PopupBlockedError extends Error {
  constructor() {
    super('identity_verification_popup_blocked');
  }
}

/**
 * On web a tab opened after a network call is not tied to the tap any more and browsers block it.
 * So the tab is opened here, inside the tap, blank, and pointed at the provider page once the
 * session exists. It is cut loose from the app (no opener) as `noopener` would do.
 */
function openBlankTab(): Window | null {
  const tab = globalThis.window?.open('', '_blank') ?? null;
  if (tab) tab.opener = null;
  return tab;
}

interface StartRequest {
  readonly consentGiven: boolean;
  /** Web only: the tab opened in the tap; null when the browser blocked it. */
  readonly tab: Window | null;
}

/**
 * Records consent, opens the provider-hosted flow (in-app browser on iOS / Android, a tab on
 * web) and, once the member is back, refreshes the status and the profile badge. The level is
 * set only by the provider's webhook; coming back never sets it (FR-VERIFY-005 AC4).
 * Nothing is started without a ticked consent.
 */
export function useStartIdentityVerification() {
  const userId = useAuthStore((s) => s.session?.userId) ?? '';
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async ({ consentGiven, tab }: StartRequest) => {
      // A blocked tab is known before anything is created: stop here, so no provider session is
      // opened (and no attempt or cost used) for a window the member can never reach.
      if (Platform.OS === 'web' && (!tab || tab.closed)) throw new PopupBlockedError();
      let hostedUrl: string;
      try {
        ({ hostedUrl } = await getStartIdentityVerificationUseCase().execute({ consentGiven }));
      } catch (error) {
        tab?.close();
        throw error;
      }
      if (Platform.OS === 'web') {
        if (!tab || tab.closed) throw new PopupBlockedError();
        tab.location.href = hostedUrl;
      } else {
        // Resolves when the member closes the browser sheet.
        await WebBrowser.openBrowserAsync(hostedUrl);
      }
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: identityVerificationKeys.status(userId) }),
        queryClient.invalidateQueries({ queryKey: userProfileKeys.byId(userId) }),
      ]);
    },
  });
  const errorCode: IdentityStartErrorCode | null = mutation.error
    ? mutation.error instanceof PopupBlockedError
      ? 'popup_blocked'
      : isIdentityVerificationError(mutation.error) ? mutation.error.code : 'unavailable'
    : null;
  const start = (consentGiven: boolean) => {
    if (!consentGiven) return;
    mutation.mutate({ consentGiven, tab: Platform.OS === 'web' ? openBlankTab() : null });
  };
  return { start, isStarting: mutation.isPending, errorCode };
}
