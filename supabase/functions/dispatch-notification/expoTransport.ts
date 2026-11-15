// dispatch-notification — the Expo push service behind the transport port.
//
// The app registers Expo push tokens (expo-notifications `getExpoPushTokenAsync`), so this
// is the one provider that reaches both APNs and FCM. Errors carry the HTTP status only:
// a response body can echo tokens and is never put in an error or a log.
import { type ProviderMessage, type PushTransport, type Ticket, TransportError } from './types.ts';

const SEND_URL = 'https://exp.host/--/api/v2/push/send';
const RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';

interface ExpoTicket {
  status?: string;
  id?: string;
  details?: { error?: string };
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

function toTicket(raw: ExpoTicket | undefined): Ticket {
  if (raw?.status === 'ok') return { status: 'ok', id: raw.id };
  return { status: 'error', error: raw?.details?.error ?? 'unknown_error' };
}

/** The wire form of a message: everything but the worker's own `platform` marker. */
export function toExpoMessage(message: ProviderMessage): Record<string, unknown> {
  const { platform: _platform, ...wire } = message;
  return wire;
}

export function createExpoTransport(accessToken: string | undefined, fetchFn: Fetch = fetch): PushTransport {
  const post = async (url: string, body: unknown): Promise<{ data?: unknown }> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    let response: Response;
    try {
      response = await fetchFn(url, { method: 'POST', headers, body: JSON.stringify(body) });
    } catch {
      throw new TransportError('expo_unreachable', true);
    }
    if (!response.ok) {
      await response.body?.cancel();
      // Rate limit and server errors pass; any other status will fail the same way again.
      throw new TransportError(`expo_http_${response.status}`, response.status === 429 || response.status >= 500);
    }
    try {
      return await response.json();
    } catch {
      throw new TransportError('expo_bad_response', true);
    }
  };

  return {
    async send(messages) {
      const json = await post(SEND_URL, messages.map(toExpoMessage));
      const tickets = Array.isArray(json.data) ? (json.data as ExpoTicket[]) : [];
      // One ticket per message, in order; anything else cannot be matched to devices.
      if (tickets.length !== messages.length) throw new TransportError('expo_ticket_mismatch', true);
      return tickets.map(toTicket);
    },
    async getReceipts(ticketIds) {
      const json = await post(RECEIPTS_URL, { ids: ticketIds });
      const data = (json.data ?? {}) as Record<string, ExpoTicket>;
      return Object.fromEntries(Object.entries(data).map(([id, raw]) => [id, toTicket(raw)]));
    },
  };
}
