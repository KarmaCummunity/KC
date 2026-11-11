import { describe, it, expect } from 'vitest';
import { BackendRuleError, BackendUnavailableError } from '@kc/domain';
import { createFakeClient } from '../../__tests__/fakeBaselineClient';
import { fetchBootstrapSession, parseBootstrapSession } from '../bootstrapSession';

const FULL_PAYLOAD = {
  user_id: 'u1',
  account: {
    status: 'suspended_admin',
    status_until: '2026-12-01T00:00:00Z',
    onboarding_state: 'pending_avatar',
    deletion_requested_at: null,
    deletion_purge_at: null,
  },
  private_profile: {
    contact_phone: '050-1234567',
    date_of_birth: '1990-05-15',
    profile_street: 'Herzl',
    profile_street_number: '12',
    notification_preferences: { critical: false },
    show_active_status: false,
    closure_explainer_dismissed: true,
    first_post_nudge_dismissed: true,
    basic_info_skipped: true,
  },
  unread: { chats: 2, notifications: 3 },
  admin: { roles: ['super_admin', 'moderator'] },
  flags: {},
  consents: {},
  legal: {
    needs_reacknowledgement: true,
    blocking: true,
    documents: [
      {
        doc_type: 'terms',
        current_version: 3,
        current_effective_date: '2026-05-20T00:00:00Z',
        last_material_version: 2,
        last_material_severity: 'critical',
        last_accepted_version: 1,
        block_mode: 'modal',
      },
    ],
  },
};

describe('parseBootstrapSession', () => {
  it('reads the account gate, the private profile, the staff roles and the pending legal documents', () => {
    const session = parseBootstrapSession(FULL_PAYLOAD);

    expect(session.userId).toBe('u1');
    expect(session.account).toEqual({
      status: 'suspended_admin',
      statusUntil: '2026-12-01T00:00:00Z',
      onboardingState: 'pending_avatar',
      deletionRequestedAt: null,
      deletionPurgeAt: null,
    });
    expect(session.privateProfile).toEqual({
      contactPhone: '050-1234567',
      dateOfBirth: '1990-05-15',
      profileStreet: 'Herzl',
      profileStreetNumber: '12',
      notificationPreferences: { critical: false },
      showActiveStatus: false,
      closureExplainerDismissed: true,
      firstPostNudgeDismissed: true,
      basicInfoSkipped: true,
    });
    expect(session.adminRoles).toEqual(['super_admin', 'moderator']);
    expect(session.legalDocuments).toEqual([
      {
        docType: 'terms',
        currentVersion: 3,
        currentEffectiveDate: '2026-05-20T00:00:00Z',
        lastMaterialVersion: 2,
        lastMaterialSeverity: 'critical',
        lastAcceptedVersion: 1,
        blockMode: 'modal',
      },
    ]);
  });

  it('falls back to neutral values for missing keys, keeping the column defaults', () => {
    const session = parseBootstrapSession({ user_id: 'u2' });

    expect(session.account.status).toBe('');
    expect(session.privateProfile.showActiveStatus).toBe(true);
    expect(session.privateProfile.basicInfoSkipped).toBe(false);
    expect(session.privateProfile.notificationPreferences).toEqual({});
    expect(session.legalDocuments).toEqual([]);
    expect(session.adminRoles).toEqual([]);
  });

  it('ignores non-string staff roles and non-object legal entries', () => {
    const session = parseBootstrapSession({ admin: { roles: ['support', 7, null] }, legal: { documents: [null] } });

    expect(session.adminRoles).toEqual(['support']);
    expect(session.legalDocuments).toHaveLength(1);
    expect(session.legalDocuments[0]?.docType).toBe('');
  });
});

describe('fetchBootstrapSession', () => {
  it('calls bootstrap_session once, without arguments', async () => {
    const { client, calls } = createFakeClient({ rpc: { bootstrap_session: { data: FULL_PAYLOAD, error: null } } });

    const session = await fetchBootstrapSession(client);

    expect(session.userId).toBe('u1');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ kind: 'rpc', fn: 'bootstrap_session' });
  });

  it('refuses with the stable reason `unauthenticated` for a signed-out caller', async () => {
    const { client } = createFakeClient({
      rpc: { bootstrap_session: { data: null, error: { code: '42501', message: 'unauthenticated' } } },
    });

    await expect(fetchBootstrapSession(client)).rejects.toBeInstanceOf(BackendRuleError);
    await expect(fetchBootstrapSession(client)).rejects.toMatchObject({ reason: 'unauthenticated' });
  });

  it('reports a missing function as BackendUnavailableError', async () => {
    const { client } = createFakeClient({
      rpc: { bootstrap_session: { data: null, error: { code: 'PGRST202', message: 'not in the schema cache' } } },
    });

    await expect(fetchBootstrapSession(client)).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});
