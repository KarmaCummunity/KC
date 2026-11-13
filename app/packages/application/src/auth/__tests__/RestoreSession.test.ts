import { describe, it, expect } from 'vitest';
import { RestoreSessionUseCase } from '../RestoreSession';
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
