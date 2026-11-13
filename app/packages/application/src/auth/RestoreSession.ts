/** FR-AUTH-013: Restore persisted session on cold start. */
import type { IAuthService, AuthSession } from '../ports/IAuthService';
import type { AccountGateResult, IAccountGateRepository } from '../ports/IAccountGateRepository';

/**
 * How long a cold start waits for the account gate before it continues with the restored session
 * (PM decision, NFR-PERF-005). Without a bound the splash lasted up to the 25 s request timeout on
 * a slow network. A banned or suspended member then sees the app until `useEnforceAccountGate`, which
 * re-checks the gate as soon as the session is set, signs them out.
 */
export const COLD_START_GATE_WAIT_MS = 10_000;

const GATE_WAIT_ELAPSED = Symbol('gate-wait-elapsed');

export interface RestoreSessionOutput {
  session: AuthSession | null;
  /** Why a persisted session was discarded (absent when there was none, or it was kept). */
  endedBy?: 'session_expired' | 'account_gate_denied';
  /** Gate denial reason (account status) when `endedBy` is `account_gate_denied`. */
  gateReason?: string | null;
  /** True when the session was kept only because the gate check itself failed. */
  gateCheckFailed?: boolean;
  /**
   * True when the gate did not answer within the bound and the session was kept. The in-session
   * check (`useEnforceAccountGate`) enforces the answer; the late result is not applied here.
   */
  gateCheckTimedOut?: boolean;
}

export class RestoreSessionUseCase {
  constructor(
    private readonly auth: IAuthService,
    private readonly gate: IAccountGateRepository,
    private readonly gateWaitMs: number = COLD_START_GATE_WAIT_MS,
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
    // A slow answer is bounded the same way (`gateWaitMs`): the splash must not hold for the
    // request timeout, and `useEnforceAccountGate` checks again the moment the session is set.
    try {
      const gateResult = await this.checkGateWithin(session.userId);
      if (gateResult === GATE_WAIT_ELAPSED) return { session, gateCheckTimedOut: true };
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

  /** The gate answer, or `GATE_WAIT_ELAPSED` when it takes longer than the bound. */
  private async checkGateWithin(userId: string): Promise<AccountGateResult | typeof GATE_WAIT_ELAPSED> {
    const check = this.gate.checkAccountGate(userId);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const elapsed = new Promise<typeof GATE_WAIT_ELAPSED>((resolve) => {
      timer = setTimeout(() => resolve(GATE_WAIT_ELAPSED), this.gateWaitMs);
    });
    try {
      return await Promise.race([check, elapsed]);
    } finally {
      clearTimeout(timer);
      // A check that loses the race may still fail later; that must not become an unhandled rejection.
      check.catch(() => undefined);
    }
  }
}
