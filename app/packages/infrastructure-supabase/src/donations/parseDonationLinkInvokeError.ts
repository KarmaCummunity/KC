import { DonationLinkError, type DonationLinkErrorCode } from '@kc/application';

const EDGE_CODES = new Set<DonationLinkErrorCode>([
  'invalid_input',
  'invalid_url',
  'unreachable',
  'rate_limited',
  'unauthorized',
  'forbidden',
  'unknown',
]);

function asEdgeCode(raw: unknown): DonationLinkErrorCode {
  if (typeof raw === 'string' && EDGE_CODES.has(raw as DonationLinkErrorCode)) {
    return raw as DonationLinkErrorCode;
  }
  if (raw === 'server_error') return 'unknown';
  return 'unknown';
}

/** Recover `{ ok, code }` from a failed Edge Function HTTP response when possible. */
export async function donationLinkErrorFromInvokeFailure(error: unknown): Promise<DonationLinkError> {
  const ctx = (error as { context?: Response }).context;
  if (ctx && typeof ctx.clone === 'function') {
    try {
      const body = (await ctx.clone().json()) as { ok?: boolean; code?: string } | null;
      if (body && body.ok === false) {
        return new DonationLinkError(asEdgeCode(body.code), `validate-donation-link returned ${body.code ?? 'unknown'}`, error);
      }
    } catch {
      /* ignore — fall through */
    }
  }
  const message = error instanceof Error ? error.message : 'invoke failed';
  return new DonationLinkError('network', message, error);
}

export function donationLinkErrorFromInvokeData(data: { ok: boolean; code?: string; link?: unknown } | null): DonationLinkError {
  const code = asEdgeCode(data?.code);
  return new DonationLinkError(code, `validate-donation-link returned ${code}`);
}
