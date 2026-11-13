import { describe, expect, it } from 'vitest';
import {
  ORG_APPLICATION_STATUSES,
  isOrgApplicationError,
  isOrgApplicationOpen,
  OrgApplicationError,
  parseOrgApplicationStatus,
} from '../OrgApplication';

describe('parseOrgApplicationStatus', () => {
  it.each(ORG_APPLICATION_STATUSES)('accepts the canonical status "%s"', (s) => {
    expect(parseOrgApplicationStatus(s)).toBe(s);
  });

  it('rejects an unknown status', () => {
    expect(parseOrgApplicationStatus('limbo')).toBeNull();
  });

  it('returns null for nullish input', () => {
    expect(parseOrgApplicationStatus(null)).toBeNull();
    expect(parseOrgApplicationStatus(undefined)).toBeNull();
  });
});

describe('OrgApplicationError', () => {
  it('carries the code and an explicit message when given', () => {
    const e = new OrgApplicationError('forbidden', 'denied');
    expect(e.code).toBe('forbidden');
    expect(e.message).toBe('denied');
    expect(e.name).toBe('OrgApplicationError');
  });

  it('falls back to the code when no message is given', () => {
    expect(new OrgApplicationError('application_not_found').message).toBe('application_not_found');
  });
});

describe('isOrgApplicationError', () => {
  it('narrows OrgApplicationError instances', () => {
    expect(isOrgApplicationError(new OrgApplicationError('unknown'))).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isOrgApplicationError(new Error('plain'))).toBe(false);
    expect(isOrgApplicationError(null)).toBe(false);
    expect(isOrgApplicationError({ code: 'forbidden' })).toBe(false);
  });
});

describe('isOrgApplicationOpen', () => {
  it('is true only while the application waits for a decision', () => {
    expect(ORG_APPLICATION_STATUSES.filter((status) => isOrgApplicationOpen(status))).toEqual(['pending']);
  });

  it('is false for a status the app does not know', () => {
    expect(isOrgApplicationOpen('a_newer_status')).toBe(false);
  });
});
