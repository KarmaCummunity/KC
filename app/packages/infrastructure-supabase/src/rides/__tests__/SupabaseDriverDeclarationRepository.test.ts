import { describe, expect, it } from 'vitest';
import { BackendRuleError, BackendUnavailableError } from '@kc/domain';
import { callsTo, createFakeClient } from '../../__tests__/fakeBaselineClient';
import { fail, ok } from '../../posts/__tests__/cardFixtures';
import { SupabaseDriverDeclarationRepository, parseDeclarationState } from '../SupabaseDriverDeclarationRepository';

const SESSION = (accepted: boolean) => ({ consents: { driver_declaration: { version: 1, accepted } } });
const CONSENT = { id: 'c1', user_id: 'u1', version: 1, accepted_at: '2026-01-01T00:00:00Z' };

describe('parseDeclarationState', () => {
  it('reads the version in force and whether the caller accepted it', () => {
    expect(parseDeclarationState(SESSION(true))).toEqual({ version: 1, accepted: true });
    expect(parseDeclarationState({})).toBeNull();
    expect(parseDeclarationState({ consents: { driver_declaration: { version: 'x' } } })).toBeNull();
  });
});

describe('SupabaseDriverDeclarationRepository', () => {
  it('returns the accepted declaration of the version in force', async () => {
    const { client } = createFakeClient({ rpc: { bootstrap_session: ok(SESSION(true)) }, tables: { user_consents: ok(CONSENT) } });
    expect(await new SupabaseDriverDeclarationRepository(client).getMine()).toEqual({
      userId: 'u1', version: 1, declaredAt: '2026-01-01T00:00:00Z',
    });
  });

  it('returns null before the declaration is accepted', async () => {
    const { client } = createFakeClient({ rpc: { bootstrap_session: ok(SESSION(false)) } });
    expect(await new SupabaseDriverDeclarationRepository(client).getMine()).toBeNull();
  });

  it('accepts the version in force', async () => {
    const { client, calls } = createFakeClient({
      rpc: { bootstrap_session: ok(SESSION(false)), accept_world_consent: ok(CONSENT) },
    });
    const declaration = await new SupabaseDriverDeclarationRepository(client).accept();
    expect(declaration.version).toBe(1);
    expect(callsTo(calls, 'accept_world_consent')[0]?.args).toEqual({ p_kind: 'driver_declaration', p_version: 1 });
  });

  it('does not accept twice', async () => {
    const { client, calls } = createFakeClient({ rpc: { bootstrap_session: ok(SESSION(true)) }, tables: { user_consents: ok(CONSENT) } });
    await new SupabaseDriverDeclarationRepository(client).accept();
    expect(callsTo(calls, 'accept_world_consent')).toHaveLength(0);
  });

  it('keeps a stale-version refusal and reports a missing function', async () => {
    const stale = createFakeClient({ rpc: { bootstrap_session: ok(SESSION(false)), accept_world_consent: fail('P0001', 'consent_version_stale') } });
    await expect(new SupabaseDriverDeclarationRepository(stale.client).accept()).rejects.toBeInstanceOf(BackendRuleError);
    const missing = createFakeClient({ rpc: { bootstrap_session: fail('PGRST202', 'nope') } });
    await expect(new SupabaseDriverDeclarationRepository(missing.client).getMine()).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});
