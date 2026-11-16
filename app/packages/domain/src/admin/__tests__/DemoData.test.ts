import { describe, expect, it } from 'vitest';
import { DemoDataError, hasDemoData, isDemoDataError, type DemoDataStatus } from '../DemoData';

const EMPTY: DemoDataStatus = {
  demoUsers: 0, demoOrganizations: 0, demoItemPosts: 0, demoRidePosts: 0, demoFollows: 0,
  demoChats: 0, demoOrgMemberships: 0, canSeed: true, hasSavedPassword: false,
};

describe('DemoData (FR-ADMIN-031)', () => {
  it('there is demo data to wipe when a demo member or a demo nonprofit exists', () => {
    expect(hasDemoData(EMPTY)).toBe(false);
    expect(hasDemoData({ ...EMPTY, demoUsers: 1 })).toBe(true);
    // A nonprofit kept for its payment history is still demo data the wipe reports.
    expect(hasDemoData({ ...EMPTY, demoOrganizations: 1 })).toBe(true);
  });

  it('DemoDataError carries its code and is recognised by the guard', () => {
    const e = new DemoDataError('not_dev_environment');
    expect(e.code).toBe('not_dev_environment');
    expect(e.message).toBe('not_dev_environment');
    expect(isDemoDataError(e)).toBe(true);
    expect(isDemoDataError(new Error('x'))).toBe(false);
  });
});
