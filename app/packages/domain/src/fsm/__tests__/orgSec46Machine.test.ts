import { describe, expect, it } from 'vitest';
import { canTransition } from '../machine';
import { orgSec46Machine } from '../machines/orgSec46';

describe('org_sec46 machine (FR-FIN-007)', () => {
  it('records an application, an approval and a renewal', () => {
    expect(canTransition(orgSec46Machine, 'none', 'pending').ok).toBe(true);
    expect(canTransition(orgSec46Machine, 'pending', 'active').ok).toBe(true);
    expect(canTransition(orgSec46Machine, 'expired', 'active').ok).toBe(true);
    expect(canTransition(orgSec46Machine, 'revoked', 'active').ok).toBe(true);
  });

  it('expires an active approval only as the system', () => {
    expect(canTransition(orgSec46Machine, 'active', 'expired', 'system').ok).toBe(true);
    expect(canTransition(orgSec46Machine, 'active', 'expired')).toMatchObject({ ok: false });
    expect(canTransition(orgSec46Machine, 'pending', 'expired', 'system')).toEqual({ ok: false, code: 'illegal_transition' });
  });

  it('revokes only an active approval, and clears any record', () => {
    expect(canTransition(orgSec46Machine, 'active', 'revoked').ok).toBe(true);
    expect(canTransition(orgSec46Machine, 'expired', 'revoked')).toEqual({ ok: false, code: 'illegal_transition' });
    for (const from of ['pending', 'active', 'expired', 'revoked'] as const) {
      expect(canTransition(orgSec46Machine, from, 'none').ok).toBe(true);
    }
  });
});
