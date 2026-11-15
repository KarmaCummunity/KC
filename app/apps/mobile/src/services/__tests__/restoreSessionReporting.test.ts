// Cold-start restore: every discarded or degraded outcome is reported with a reason.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const execute = vi.hoisted(() => vi.fn());
const report = vi.hoisted(() => vi.fn());
vi.mock('../authComposition', () => ({ getRestoreSessionUseCase: () => ({ execute }) }));
vi.mock('../../lib/observability/reportAuthEvent', () => ({ reportAuthEvent: report }));

import { restoreSessionReporting } from '../restoreSessionReporting';

const session = { userId: 'u_1' } as never;

describe('restoreSessionReporting', () => {
  beforeEach(() => {
    execute.mockReset();
    report.mockReset();
  });

  it('returns the session and reports nothing on the happy path', async () => {
    execute.mockResolvedValue({ session });
    expect(await restoreSessionReporting()).toBe(session);
    expect(report).not.toHaveBeenCalled();
  });

  it('reports an expired session that was discarded', async () => {
    execute.mockResolvedValue({ session: null, endedBy: 'session_expired' });
    expect(await restoreSessionReporting()).toBeNull();
    expect(report).toHaveBeenCalledWith('restore_session_expired');
  });

  it('reports a gate denial with the account status', async () => {
    execute.mockResolvedValue({ session: null, endedBy: 'account_gate_denied', gateReason: 'pending_verification' });
    await restoreSessionReporting();
    expect(report).toHaveBeenCalledWith('restore_gate_denied', { account_status: 'pending_verification' });
  });

  it('reports a failing gate check when the session was kept', async () => {
    execute.mockResolvedValue({ session, gateCheckFailed: true });
    expect(await restoreSessionReporting()).toBe(session);
    expect(report).toHaveBeenCalledWith('gate_check_failed', { phase: 'cold_start' });
  });

  it('reports a gate check that did not answer in time when the session was kept', async () => {
    execute.mockResolvedValue({ session, gateCheckTimedOut: true });
    expect(await restoreSessionReporting()).toBe(session);
    expect(report).toHaveBeenCalledWith('gate_check_failed', { phase: 'cold_start_timeout' });
  });

  it('reports and rethrows a restore failure', async () => {
    const err = new Error('keychain locked');
    execute.mockRejectedValue(err);
    await expect(restoreSessionReporting()).rejects.toBe(err);
    expect(report).toHaveBeenCalledWith('restore_failed', {}, err);
  });
});
