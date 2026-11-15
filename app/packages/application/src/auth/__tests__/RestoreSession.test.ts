import { afterEach, describe, it, expect, vi } from 'vitest';
import { COLD_START_GATE_WAIT_MS, RestoreSessionUseCase } from '../RestoreSession';
import type { AccountGateResult } from '../../ports/IAccountGateRepository';
import { FakeAuthService, makeSession } from './fakeAuthService';
import { FakeAccountGateRepository } from '../../moderation/__tests__/fakeAccountGateRepository';

describe('RestoreSessionUseCase', () => {
  it('returns null when no session is persisted (FR-AUTH-013 AC1)', async () => {
    const auth = new FakeAuthService();
    const gate = new FakeAccountGateRepository();
    auth.currentSession = null;
    const uc = new RestoreSessionUseCase(auth, gate);

    const out = await uc.execute();
    expect(out.session).toBeNull();
    expect(gate.calls).toHaveLength(0);
  });

  it('returns the session when valid and gate allows', async () => {
    const auth = new FakeAuthService();
    const gate = new FakeAccountGateRepository();
    auth.currentSession = makeSession({ expiresAt: Math.floor(Date.now() / 1000) + 600 });
    const uc = new RestoreSessionUseCase(auth, gate);

    const out = await uc.execute();
    expect(out.session).not.toBeNull();
    expect(out.session?.userId).toBe('u_1');
    expect(gate.calls).toEqual(['u_1']);
  });

  it('discards an expired session (FR-AUTH-013 AC1: expired routes to splash)', async () => {
    const auth = new FakeAuthService();
    const gate = new FakeAccountGateRepository();
    auth.currentSession = makeSession({ expiresAt: Math.floor(Date.now() / 1000) - 10 });
    const uc = new RestoreSessionUseCase(auth, gate);

    const out = await uc.execute();
    expect(out.session).toBeNull();
    expect(auth.signOutCalled).toBe(1);
    expect(out.endedBy).toBe('session_expired');
    // Gate should not be consulted for an already-expired session.
    expect(gate.calls).toHaveLength(0);
  });

  it('TD-68: signs out and returns null when the gate denies (suspended/banned)', async () => {
    const auth = new FakeAuthService();
    const gate = new FakeAccountGateRepository();
    auth.currentSession = makeSession({ expiresAt: Math.floor(Date.now() / 1000) + 600 });
    gate.result = { allowed: false, reason: 'banned' };
    const uc = new RestoreSessionUseCase(auth, gate);

    const out = await uc.execute();
    expect(out.session).toBeNull();
    expect(auth.signOutCalled).toBe(1);
    expect(out.endedBy).toBe('account_gate_denied');
    expect(out.gateReason).toBe('banned');
    expect(gate.calls).toEqual(['u_1']);
  });

  it('TD-68: returns the session when the gate throws (graceful — 60s poll backstop)', async () => {
    const auth = new FakeAuthService();
    const gate = new FakeAccountGateRepository();
    auth.currentSession = makeSession({ expiresAt: Math.floor(Date.now() / 1000) + 600 });
    // Override checkAccountGate to throw.
    gate.checkAccountGate = async () => {
      throw new Error('network down');
    };
    const uc = new RestoreSessionUseCase(auth, gate);

    const out = await uc.execute();
    expect(out.session).not.toBeNull();
    expect(out.session?.userId).toBe('u_1');
    expect(out.gateCheckFailed).toBe(true);
    expect(auth.signOutCalled).toBe(0);
  });
});

describe('RestoreSessionUseCase — bounded gate wait (NFR-PERF-005)', () => {
  afterEach(() => vi.useRealTimers());

  /** A gate whose answer arrives only when the test says so, after `delayMs` of fake time. */
  function slowGate(result: AccountGateResult | Error, delayMs: number) {
    const gate = new FakeAccountGateRepository();
    gate.checkAccountGate = (userId: string) => {
      gate.calls.push(userId);
      return new Promise<AccountGateResult>((resolve, reject) => {
        setTimeout(() => (result instanceof Error ? reject(result) : resolve(result)), delayMs);
      });
    };
    return gate;
  }

  function setup(gate: FakeAccountGateRepository) {
    vi.useFakeTimers();
    const auth = new FakeAuthService();
    auth.currentSession = makeSession({ expiresAt: Math.floor(Date.now() / 1000) + 600 });
    return { auth, uc: new RestoreSessionUseCase(auth, gate) };
  }

  it('keeps the session when the gate allows within the bound', async () => {
    const { uc } = setup(slowGate({ allowed: true }, COLD_START_GATE_WAIT_MS - 1_000));
    const pending = uc.execute();
    await vi.advanceTimersByTimeAsync(COLD_START_GATE_WAIT_MS - 1_000);
    const out = await pending;
    expect(out.session?.userId).toBe('u_1');
    expect(out.gateCheckTimedOut).toBeUndefined();
  });

  it('TD-68: signs the member out when the gate refuses within the bound', async () => {
    const { auth, uc } = setup(slowGate({ allowed: false, reason: 'banned' }, COLD_START_GATE_WAIT_MS - 1_000));
    const pending = uc.execute();
    await vi.advanceTimersByTimeAsync(COLD_START_GATE_WAIT_MS - 1_000);
    const out = await pending;
    expect(out.session).toBeNull();
    expect(out.endedBy).toBe('account_gate_denied');
    expect(auth.signOutCalled).toBe(1);
  });

  it('restores the session without waiting longer when the gate is slower than the bound', async () => {
    const { auth, uc } = setup(slowGate({ allowed: false, reason: 'banned' }, 25_000));
    const pending = uc.execute();
    await vi.advanceTimersByTimeAsync(COLD_START_GATE_WAIT_MS);
    const out = await pending;
    expect(out.session?.userId).toBe('u_1');
    expect(out.gateCheckTimedOut).toBe(true);
    // The late refusal is enforced by the in-session check, not applied (or double-applied) here.
    await vi.advanceTimersByTimeAsync(25_000);
    expect(auth.signOutCalled).toBe(0);
  });

  it('keeps the session and flags a failed check that comes in time', async () => {
    const { uc } = setup(slowGate(new Error('network down'), 1_000));
    const pending = uc.execute();
    await vi.advanceTimersByTimeAsync(1_000);
    const out = await pending;
    expect(out.session?.userId).toBe('u_1');
    expect(out.gateCheckFailed).toBe(true);
    expect(out.gateCheckTimedOut).toBeUndefined();
  });

  it('does not raise when a check that lost the race fails afterwards', async () => {
    const { uc } = setup(slowGate(new Error('late failure'), 25_000));
    const pending = uc.execute();
    await vi.advanceTimersByTimeAsync(COLD_START_GATE_WAIT_MS);
    await pending;
    await expect(vi.advanceTimersByTimeAsync(25_000)).resolves.not.toThrow();
  });
});
