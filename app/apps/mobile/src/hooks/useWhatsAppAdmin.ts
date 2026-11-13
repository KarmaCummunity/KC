// #939 — the admin WhatsApp console's queries. Every key starts with WHATSAPP_ADMIN_KEY so one
// invalidation refreshes the whole console after an action. The consent, outbound and review
// lists are keyset-paged (useKeysetPages); the short lists take the server's default limit.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  WhatsAppConsentRow,
  WhatsAppOutboundRow,
  WhatsAppReviewItem,
} from '@kc/domain';
import { container } from '../lib/container';
import { useKeysetPages } from './useKeysetPages';

export const WHATSAPP_ADMIN_KEY = 'admin.whatsapp';
const STALE = 15_000;

/** Refreshes every console query. */
export function useInvalidateWhatsAppAdmin(): () => void {
  const queryClient = useQueryClient();
  return () => { void queryClient.invalidateQueries({ queryKey: [WHATSAPP_ADMIN_KEY] }); };
}

export function useWhatsAppOverview(enabled: boolean) {
  return useQuery({
    queryKey: [WHATSAPP_ADMIN_KEY, 'overview'],
    queryFn: () => container.getWhatsAppAdminOverview.execute(),
    enabled,
    staleTime: STALE,
  });
}

export function useWhatsAppChannel(enabled: boolean) {
  return useQuery({
    queryKey: [WHATSAPP_ADMIN_KEY, 'channel'],
    queryFn: () => container.getWhatsAppChannel.execute(),
    enabled,
    staleTime: STALE,
  });
}

export function useWhatsAppOutboundList(status: string | undefined, enabled: boolean) {
  return useKeysetPages<WhatsAppOutboundRow, { status?: string }>(
    [WHATSAPP_ADMIN_KEY, 'outbound'], status ? { status } : {},
    (f) => container.listWhatsAppOutbound.execute(f), enabled,
  );
}

export function useWhatsAppConsentList(enabled: boolean) {
  return useKeysetPages<WhatsAppConsentRow, Record<string, never>>(
    [WHATSAPP_ADMIN_KEY, 'consent'], {}, (f) => container.listWhatsAppConsent.execute(f), enabled,
  );
}

export function useWhatsAppReviewList(enabled: boolean) {
  return useKeysetPages<WhatsAppReviewItem, { status: 'pending' }>(
    [WHATSAPP_ADMIN_KEY, 'reviews'], { status: 'pending' },
    (f) => container.listWhatsAppReviews.execute(f), enabled,
  );
}

export function useWhatsAppActivity(enabled: boolean) {
  const matches = useQuery({
    queryKey: [WHATSAPP_ADMIN_KEY, 'matches'],
    queryFn: () => container.listWhatsAppRecentMatches.execute(),
    enabled,
    staleTime: STALE,
  });
  const rateHits = useQuery({
    queryKey: [WHATSAPP_ADMIN_KEY, 'rateHits'],
    queryFn: () => container.listWhatsAppRateHits.execute(),
    enabled,
    staleTime: STALE,
  });
  const conversations = useQuery({
    queryKey: [WHATSAPP_ADMIN_KEY, 'conversations'],
    queryFn: () => container.listWhatsAppConversations.execute(),
    enabled,
    staleTime: STALE,
  });
  return { matches, rateHits, conversations };
}

export function useWhatsAppTemplates(enabled: boolean) {
  return useQuery({
    queryKey: [WHATSAPP_ADMIN_KEY, 'templates'],
    queryFn: () => container.listWhatsAppTemplates.execute(),
    enabled,
    staleTime: STALE,
  });
}

export function useWhatsAppSendLimits(enabled: boolean) {
  return useQuery({
    queryKey: [WHATSAPP_ADMIN_KEY, 'sendLimits'],
    queryFn: () => container.getWhatsAppSendLimits.execute(),
    enabled,
    staleTime: STALE,
  });
}
