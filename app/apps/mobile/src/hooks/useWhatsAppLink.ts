// #1090 — Settings → WhatsApp: the member's link status, a one-time link code, unlink and the
// match-alert switch (FR-NOTIF-017 AC4), all through the WhatsApp link use cases.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isWhatsAppLinkError, type WhatsAppLinkCode, type WhatsAppLinkStatus } from '@kc/domain';
import { container } from '../lib/container';

export const WHATSAPP_LINK_STATUS_KEY = ['settings.whatsapp.status'] as const;

/** The settings copy key for a failed action. */
export function whatsappLinkErrorKey(error: unknown): string {
  if (isWhatsAppLinkError(error) && error.code === 'pro_required') return 'settings.whatsapp.proRequired';
  if (isWhatsAppLinkError(error) && error.code === 'rate_limited') return 'settings.whatsapp.rateLimited';
  return 'settings.whatsapp.failed';
}

export function useWhatsAppLink() {
  const queryClient = useQueryClient();
  const [code, setCode] = useState<WhatsAppLinkCode | null>(null);
  const [error, setError] = useState<unknown>(null);
  const status = useQuery({
    queryKey: WHATSAPP_LINK_STATUS_KEY,
    queryFn: () => container.getWhatsAppLinkStatus.execute(),
  });
  const store = (next: WhatsAppLinkStatus) => queryClient.setQueryData(WHATSAPP_LINK_STATUS_KEY, next);
  const onError = (e: unknown) => setError(e);

  const createCode = useMutation({
    mutationFn: () => container.createWhatsAppLinkCode.execute(status.data),
    onMutate: () => setError(null),
    onSuccess: setCode,
    onError,
  });
  const unlink = useMutation({
    mutationFn: () => container.unlinkWhatsApp.execute(),
    onMutate: () => setError(null),
    onSuccess: async () => {
      setCode(null);
      await queryClient.invalidateQueries({ queryKey: WHATSAPP_LINK_STATUS_KEY });
    },
    onError,
  });
  const setConsent = useMutation({
    mutationFn: (optedIn: boolean) => container.setWhatsAppMatchConsent.execute(optedIn),
    onMutate: () => setError(null),
    onSuccess: store,
    onError,
  });

  return {
    status,
    code,
    error,
    busy: createCode.isPending || unlink.isPending || setConsent.isPending,
    requestCode: () => createCode.mutate(),
    unlink: () => unlink.mutate(),
    setConsent: (optedIn: boolean) => setConsent.mutate(optedIn),
  };
}
