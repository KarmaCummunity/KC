// app/packages/infrastructure-supabase/src/identityVerification/SupabaseIdentityVerificationService.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { IIdentityVerificationService, IdentityVerificationSession } from '@kc/application';
import { BackendRuleError, toIdentityVerificationStatus, type IdentityVerificationSummary } from '@kc/domain';
import { mapRpcError, unwrapCall } from '../rpc/mapRpcError';
import type { BackendErrorLike } from '../rpc/backendUnavailable';

/** Edge Function that opens a provider session for the caller (FR-VERIFY-005 AC3). */
export const IDENTITY_VERIFICATION_SESSION_FUNCTION = 'identity-verification-session';
const SESSION_OBJECT = `edge:${IDENTITY_VERIFICATION_SESSION_FUNCTION}`;

/** A stable snake_case refusal reason, as the Edge Function answers it in `{ error }`. */
const STABLE_REASON = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

/** Row shape of `my_identity_verification()`. */
interface StatusRow {
  readonly status: string | null;
  readonly reason_code: string | null;
  readonly decided_at: string | null;
  readonly verified_at: string | null;
  readonly expires_at: string | null;
}

/**
 * Reads the refusal reason from a non-2xx Edge Function answer (`{ "error": "<reason>" }`).
 * supabase-js exposes the raw `Response` as `error.context`; anything unreadable is null.
 */
async function edgeRefusalReason(error: unknown): Promise<string | null> {
  const response = (error as { context?: unknown } | null)?.context;
  if (!(response instanceof Response)) return null;
  try {
    const body: unknown = await response.clone().json();
    const reason = (body as { error?: unknown } | null)?.error;
    return typeof reason === 'string' && STABLE_REASON.test(reason) ? reason : null;
  } catch {
    return null;
  }
}

/**
 * FR-VERIFY-010 AC1 — Supabase adapter of `IIdentityVerificationService`. Status and consent are
 * RPCs on the caller's session; the provider session is opened by the Edge Function, which holds
 * the provider key. The caller's JWT is attached by the client, so no request carries an identity.
 */
export class SupabaseIdentityVerificationService implements IIdentityVerificationService {
  constructor(private readonly client: SupabaseClient) {}

  async getStatus(): Promise<IdentityVerificationSummary> {
    const rows = unwrapCall('rpc:my_identity_verification',
      await this.client.rpc('my_identity_verification')) as StatusRow[] | StatusRow | null;
    // A set-returning function arrives as an array with one row.
    const row = Array.isArray(rows) ? rows[0] : rows;
    return {
      status: toIdentityVerificationStatus(row?.status),
      reasonCode: row?.reason_code ?? null,
      decidedAt: row?.decided_at ?? null,
      verifiedAt: row?.verified_at ?? null,
      expiresAt: row?.expires_at ?? null,
    };
  }

  async acceptConsent(version: string): Promise<void> {
    unwrapCall('rpc:accept_identity_verification_consent',
      await this.client.rpc('accept_identity_verification_consent', { p_version: version }));
  }

  async startSession(): Promise<IdentityVerificationSession> {
    const { data, error } = await this.client.functions.invoke<{ url?: unknown }>(IDENTITY_VERIFICATION_SESSION_FUNCTION, {
      method: 'POST',
      body: {},
    });
    if (error) {
      const reason = await edgeRefusalReason(error);
      if (reason) throw new BackendRuleError(reason, SESSION_OBJECT, error);
      throw mapRpcError(SESSION_OBJECT, error as BackendErrorLike);
    }
    const url = data?.url;
    // Only an HTTPS address is opened in the in-app browser.
    if (typeof url !== 'string' || !url.startsWith('https://')) {
      throw new BackendRuleError('invalid_session_response', SESSION_OBJECT);
    }
    return { hostedUrl: url };
  }
}
