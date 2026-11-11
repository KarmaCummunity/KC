import { describe, expect, it, vi } from 'vitest';
import { AdminRoleError, BackendUnavailableError } from '@kc/domain';

vi.mock('../../../../i18n', () => ({ default: { t: (key: string) => key } }));

import { BACKEND_UNAVAILABLE_CODE, roleErrorCode, roleScopeErrorText } from '../roleErrors';

describe('roleErrorCode', () => {
  it('keeps the code of an AdminRoleError', () => {
    expect(roleErrorCode(new AdminRoleError('role_already_active'))).toBe('role_already_active');
  });

  it('marks a missing backend object so the screen can say "not available yet"', () => {
    expect(roleErrorCode(new BackendUnavailableError('rpc:admin_grant_role', 'function'))).toBe(BACKEND_UNAVAILABLE_CODE);
  });

  it('falls back to unknown for anything else', () => {
    expect(roleErrorCode(new Error('boom'))).toBe('unknown');
    expect(roleErrorCode('boom')).toBe('unknown');
  });
});

describe('roleScopeErrorText', () => {
  const L = {
    admin: { admins: { grantModal: { errors: { forbidden_grant: 'no grant', unknown: 'oops' } } } },
  } as never;

  it('uses the localized text of a known code, the generic one otherwise', () => {
    expect(roleScopeErrorText(L, 'forbidden_grant')).toBe('no grant');
    expect(roleScopeErrorText(L, 'something_else')).toBe('oops');
  });

  it('uses the "not available yet" message for an unavailable backend', () => {
    expect(roleScopeErrorText(L, BACKEND_UNAVAILABLE_CODE)).toBe('backend.notAvailableYet');
  });
});
