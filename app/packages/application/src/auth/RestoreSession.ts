/** FR-AUTH-013: Restore persisted session on cold start. */
import type { IAuthService, AuthSession } from '../ports/IAuthService';
import type { IAccountGateRepository } from '../ports/IAccountGateRepository';

export interface RestoreSessionOutput {
  session: AuthSession | null;
  /** Why a persisted session was discarded (absent when there was none, or it was kept). */
  endedBy?: 'session_expired' | 'account_gate_denied';
  /** Gate denial reason (account status) when `endedBy` is `account_gate_denied`. */
  gateReason?: string | null;
  /** True when the session was kept only because the gate check itself failed. */
  gateCheckFailed?: boolean;
}

export class RestoreSessionUseCase {
  constructor(
    private readonly auth: IAuthService,
    private readonly gate: IAccountGateRepository,
  ) {}

  async execute(): Promise<RestoreSessionOutput> {
    const session = await this.auth.getCurrentSession();
    if (!session) return { session: null };

    const nowSec = Math.floor(Date.now() / 1000);
    if (session.expiresAt <= nowSec) {
      await this.auth.signOut();
      return { session: null, endedBy: 'session_expired' };
    }

    // TD-68 / audit 2026-05-10 §17.1: a suspended/banned/deleted user must not
    // keep a usable session across cold start just because their JWT hasn't
    // expired. Ask the server-side gate (same RPC used by the 60s in-session
    // poll in `useEnforceAccountGate`) for an authoritative answer.
    //
    // On gate failure (network, timeout): we keep the session. Signing out on
    // every transient failure would be a denial-of-service against legitimate
    // users; the 60s in-session poll will catch a real change on the next tick.
    try {
      const gateResult = await this.gate.checkAccountGate(session.userId);
      if (!gateResult.allowed) {
        await this.auth.signOut();
        return { session: null, endedBy: 'account_gate_denied', gateReason: gateResult.reason ?? null };
      }
    } catch {
      // Best-effort: fall through with the session intact, but tell the caller so it can report.
      return { session, gateCheckFailed: true };
    }

    return { session };
  }
}
