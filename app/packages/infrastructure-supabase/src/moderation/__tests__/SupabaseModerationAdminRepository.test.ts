import { describe, it, expect } from 'vitest';
import {
  InvalidRestoreStateError,
  ModerationError,
  ModerationForbiddenError,
} from '@kc/application';
import { BackendUnavailableError } from '@kc/domain';
import { SupabaseModerationAdminRepository } from '../SupabaseModerationAdminRepository';
import { fakeStaffClient, type FakeResult } from '../../__tests__/fakeStaffClient';

const OK: FakeResult = { data: null, error: null };
const refuse = (message: string, code = 'P0001'): FakeResult => ({ data: null, error: { code, message } });

/** A repository over a fake client whose every RPC resolves to `result`. */
function repoWith(result: FakeResult, rpcNames: readonly string[] = []) {
  const rpc = Object.fromEntries(rpcNames.map((name) => [name, result]));
  const fake = fakeStaffClient({ rpc });
  return { ...fake, repo: new SupabaseModerationAdminRepository(fake.client) };
}

const ALL_RPCS = [
  'admin_dismiss_report', 'admin_confirm_report', 'admin_restore_post', 'admin_restore_user',
  'admin_ban_user', 'admin_delete_message', 'admin_restore_chat', 'admin_restore_comment', 'admin_delete_comment',
];

describe('SupabaseModerationAdminRepository — refusal mapping (stable message → typed error)', () => {
  // Every reason the moderation RPCs raise (supabase/schemas/60_moderation): `forbidden` and
  // `invalid_restore_state` route to dedicated subclasses; the rest to ModerationError(<code>).
  it.each([
    ['forbidden', '42501', ModerationForbiddenError, 'forbidden'],
    ['unauthenticated', '42501', ModerationForbiddenError, 'forbidden'],
    ['invalid_restore_state', 'P0001', InvalidRestoreStateError, 'invalid_restore_state'],
    ['report_not_open', 'P0001', ModerationError, 'report_not_open'],
    ['cannot_sanction_self', 'P0001', ModerationError, 'cannot_sanction_self'],
    ['cannot_sanction_admin', 'P0001', ModerationError, 'cannot_sanction_admin'],
    ['invalid_sanction_reason', 'P0001', ModerationError, 'invalid_sanction_reason'],
    ['account_pending_deletion', 'P0001', ModerationError, 'account_pending_deletion'],
    ['invalid_target_state', 'P0001', ModerationError, 'invalid_target_state'],
    ['target_not_found', 'P0001', ModerationError, 'target_not_found'],
    ['message_not_found', 'P0001', ModerationError, 'message_not_found'],
  ])('%s (%s) → %s', async (message, sqlstate, ExpectedClass, expectedCode) => {
    const { repo } = repoWith(refuse(message, sqlstate), ALL_RPCS);

    const failure = await repo.dismissReport('r_1').catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(ExpectedClass);
    expect((failure as ModerationError).code).toBe(expectedCode);
  });

  it('an RLS-style 42501 with an unstable message is a plain forbidden', async () => {
    const { repo } = repoWith(refuse('new row violates row-level security policy', '42501'), ALL_RPCS);

    await expect(repo.confirmReport('r_1')).rejects.toBeInstanceOf(ModerationForbiddenError);
  });

  it('an unrecognised reason or a failure that is not a refusal → ModerationError("unknown")', async () => {
    for (const result of [refuse('some_future_reason'), refuse('mystery', '23000'), { data: null, error: { message: 'no code' } }]) {
      await expect(repoWith(result, ALL_RPCS).repo.dismissReport('r_1')).rejects.toMatchObject({
        name: 'ModerationError',
        code: 'unknown',
      });
    }
  });

  it('degrades to BackendUnavailableError when the RPC is not deployed', async () => {
    const { repo } = repoWith(refuse('Could not find the function', 'PGRST202'), ALL_RPCS);

    const failure = await repo.dismissReport('r_1').catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(BackendUnavailableError);
    expect(failure).toMatchObject({ object: 'rpc:admin_dismiss_report', kind: 'function' });
  });
});

describe('SupabaseModerationAdminRepository — isPlatformStaff', () => {
  it('reads the target\'s active platform grants and returns true when one exists', async () => {
    const fake = fakeStaffClient({ tables: { admin_role_grants: { data: [{ id: 'g1' }], error: null } } });

    const staff = await new SupabaseModerationAdminRepository(fake.client).isPlatformStaff('u_1');

    expect(staff).toBe(true);
    expect(fake.chains[0]?.table).toBe('admin_role_grants');
    expect(fake.chains[0]?.calls).toEqual(expect.arrayContaining([
      ['eq', ['user_id', 'u_1']],
      ['eq', ['is_platform', true]],
      ['is', ['revoked_at', null]],
    ]));
  });

  it('returns false when the target has no active platform grant', async () => {
    const fake = fakeStaffClient({ tables: { admin_role_grants: { data: [], error: null } } });

    expect(await new SupabaseModerationAdminRepository(fake.client).isPlatformStaff('u_1')).toBe(false);
  });

  it('routes a refusal through the moderation mapper', async () => {
    const fake = fakeStaffClient({ tables: { admin_role_grants: refuse('permission denied', '42501') } });

    await expect(new SupabaseModerationAdminRepository(fake.client).isPlatformStaff('u_1')).rejects.toBeInstanceOf(
      ModerationForbiddenError,
    );
  });
});

describe('SupabaseModerationAdminRepository — admin RPCs', () => {
  it('restoreTarget(post) → admin_restore_post(p_post_id)', async () => {
    const { repo, rpcCalls } = repoWith(OK, ALL_RPCS);
    await repo.restoreTarget('post', 'p_1');
    expect(rpcCalls).toEqual([{ name: 'admin_restore_post', args: { p_post_id: 'p_1' } }]);
  });

  it('restoreTarget(user) → admin_restore_user(p_user_id)', async () => {
    const { repo, rpcCalls } = repoWith(OK, ALL_RPCS);
    await repo.restoreTarget('user', 'u_1');
    expect(rpcCalls).toEqual([{ name: 'admin_restore_user', args: { p_user_id: 'u_1' } }]);
  });

  it('restoreTarget(chat) → admin_restore_chat(p_chat_id)', async () => {
    const { repo, rpcCalls } = repoWith(OK, ALL_RPCS);
    await repo.restoreTarget('chat', 'c_1');
    expect(rpcCalls).toEqual([{ name: 'admin_restore_chat', args: { p_chat_id: 'c_1' } }]);
  });

  it('restoreTarget(comment) → admin_restore_comment(p_comment_id)', async () => {
    const { repo, rpcCalls } = repoWith(OK, ALL_RPCS);
    await repo.restoreTarget('comment', 'k_1');
    expect(rpcCalls).toEqual([{ name: 'admin_restore_comment', args: { p_comment_id: 'k_1' } }]);
  });

  it('restoreTarget(comment) maps an author-deleted comment to InvalidRestoreStateError', async () => {
    const { repo } = repoWith(refuse('invalid_restore_state'), ALL_RPCS);
    await expect(repo.restoreTarget('comment', 'k_1')).rejects.toBeInstanceOf(InvalidRestoreStateError);
  });

  it('removeComment → admin_delete_comment', async () => {
    const { repo, rpcCalls } = repoWith(OK, ALL_RPCS);
    await repo.removeComment('k_1');
    expect(rpcCalls).toEqual([{ name: 'admin_delete_comment', args: { p_comment_id: 'k_1' } }]);
  });

  it('dismissReport → admin_dismiss_report', async () => {
    const { repo, rpcCalls } = repoWith(OK, ALL_RPCS);
    await repo.dismissReport('r_1');
    expect(rpcCalls).toEqual([{ name: 'admin_dismiss_report', args: { p_report_id: 'r_1' } }]);
  });

  it('confirmReport → admin_confirm_report', async () => {
    const { repo, rpcCalls } = repoWith(OK, ALL_RPCS);
    await repo.confirmReport('r_1');
    expect(rpcCalls).toEqual([{ name: 'admin_confirm_report', args: { p_report_id: 'r_1' } }]);
  });

  it('banUser → admin_ban_user with p_user_id, p_reason and the trimmed p_note', async () => {
    const { repo, rpcCalls } = repoWith(OK, ALL_RPCS);
    await repo.banUser('u_target', 'harassment', '  pattern  ');
    expect(rpcCalls).toEqual([
      { name: 'admin_ban_user', args: { p_user_id: 'u_target', p_reason: 'harassment', p_note: 'pattern' } },
    ]);
  });

  it('banUser omits p_note when the note is blank', async () => {
    const { repo, rpcCalls } = repoWith(OK, ALL_RPCS);
    await repo.banUser('u_target', 'spam', '   ');
    expect(rpcCalls).toEqual([{ name: 'admin_ban_user', args: { p_user_id: 'u_target', p_reason: 'spam' } }]);
  });

  it('deleteMessage → admin_delete_message', async () => {
    const { repo, rpcCalls } = repoWith(OK, ALL_RPCS);
    await repo.deleteMessage('m_1');
    expect(rpcCalls).toEqual([{ name: 'admin_delete_message', args: { p_message_id: 'm_1' } }]);
  });
});

describe('SupabaseModerationAdminRepository — auditLookup', () => {
  const auditRows = (rows: unknown[]) => ({ data: rows, error: null });

  it('calls admin_audit_lookup with p_user_id + p_limit (default 200): events by or about the member', async () => {
    const fake = fakeStaffClient({ rpc: { admin_audit_lookup: auditRows([]) } });
    await new SupabaseModerationAdminRepository(fake.client).auditLookup('u_1');
    expect(fake.rpcCalls).toEqual([{ name: 'admin_audit_lookup', args: { p_user_id: 'u_1', p_limit: 200 } }]);
  });

  it('forwards an explicit limit verbatim', async () => {
    const fake = fakeStaffClient({ rpc: { admin_audit_lookup: auditRows([]) } });
    await new SupabaseModerationAdminRepository(fake.client).auditLookup('u_1', 50);
    expect((fake.rpcCalls[0]?.args as { p_limit: number }).p_limit).toBe(50);
  });

  it('maps id / occurred_at rows to the AuditEvent shape with null/{}-coalesced defaults', async () => {
    const fake = fakeStaffClient({
      rpc: {
        admin_audit_lookup: auditRows([
          {
            id: 17, actor_id: 'u_admin', action: 'ban_user', target_type: 'user', target_id: 'u_t',
            metadata: { reason: 'abuse' }, occurred_at: '2026-05-16T12:00:00.000Z',
          },
          {
            id: 16, actor_id: null, action: 'confirm_report', target_type: null, target_id: null,
            metadata: null, occurred_at: '2026-05-16T11:00:00.000Z',
          },
        ]),
      },
    });

    const out = await new SupabaseModerationAdminRepository(fake.client).auditLookup('u_1');

    expect(out[0]).toEqual({
      eventId: '17', actorId: 'u_admin', action: 'ban_user', targetType: 'user', targetId: 'u_t',
      metadata: { reason: 'abuse' }, createdAt: '2026-05-16T12:00:00.000Z',
    });
    expect(out[1]).toMatchObject({ actorId: null, targetType: null, targetId: null, metadata: {} });
  });

  it('maps a refusal of the audit lookup (not the super admin) to forbidden', async () => {
    const fake = fakeStaffClient({ rpc: { admin_audit_lookup: refuse('forbidden', '42501') } });

    await expect(new SupabaseModerationAdminRepository(fake.client).auditLookup('u_1')).rejects.toBeInstanceOf(
      ModerationForbiddenError,
    );
  });
});

describe('SupabaseModerationAdminRepository — getMyRoles', () => {
  const rolesClient = (result: FakeResult) => fakeStaffClient({ rpc: { get_my_admin_roles: result } });

  it('calls get_my_admin_roles and parses the array, dropping unknown roles', async () => {
    const fake = rolesClient({ data: ['super_admin', 'moderator', 'emperor'], error: null });
    const out = await new SupabaseModerationAdminRepository(fake.client).getMyRoles();
    expect(out).toEqual(['super_admin', 'moderator']);
    expect(fake.rpcCalls[0]?.name).toBe('get_my_admin_roles');
  });

  it('returns [] when data is not an array', async () => {
    const fake = rolesClient({ data: 'nope', error: null });
    expect(await new SupabaseModerationAdminRepository(fake.client).getMyRoles()).toEqual([]);
  });

  it('throws BackendUnavailableError when the function is not deployed (screens treat it as no roles)', async () => {
    const fake = rolesClient(refuse('missing', 'PGRST202'));
    await expect(new SupabaseModerationAdminRepository(fake.client).getMyRoles()).rejects.toBeInstanceOf(
      BackendUnavailableError,
    );
  });
});
