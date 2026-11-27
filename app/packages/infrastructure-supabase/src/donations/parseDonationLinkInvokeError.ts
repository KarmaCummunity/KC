import {
  DonationLinkError,
  isValidateDonationLinkEdgeErrorCode,
  type DonationLinkErrorCode,
} from '@kc/application';
import type { ValidateDonationLinkResponse } from '@kc/application';

function asEdgeCode(raw: unknown): DonationLinkErrorCode {
  if (isValidateDonationLinkEdgeErrorCode(raw)) return raw;
  return 'unknown';
}

/** Recover `{ ok, code }` from a failed Edge Function HTTP response when possible. */
export async function donationLinkErrorFromInvokeFailure(error: unknown): Promise<DonationLinkError> {
  const ctx = (error as { context?: Response }).context;
  if (ctx && typeof ctx.clone === 'function') {
    try {
      const body = (await ctx.clone().json()) as ValidateDonationLinkResponse | null;
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

export function donationLinkErrorFromInvokeData(
  data: { ok: boolean; code?: string; link?: unknown } | null,
): DonationLinkError {
  const code = asEdgeCode(data?.code);
  return new DonationLinkError(code, `validate-donation-link returned ${code}`);
}
