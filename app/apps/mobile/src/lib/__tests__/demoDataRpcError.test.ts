import { describe, expect, it } from 'vitest';
import { demoDataErrorKey } from '../demoDataRpcError';

describe('demoDataErrorKey', () => {
  it('maps known server errors to i18n keys', () => {
    expect(demoDataErrorKey('cannot_wipe_self')).toBe('admin.demoData.errors.cannotWipeSelf');
    expect(demoDataErrorKey('Error: forbidden')).toBe('admin.demoData.errors.forbidden');
    expect(demoDataErrorKey('not_dev_environment')).toBe('admin.demoData.errors.notDevEnvironment');
    expect(demoDataErrorKey('canceling statement due to statement timeout')).toBe(
      'admin.demoData.errors.timeout',
    );
    expect(demoDataErrorKey('Request timed out after 25000ms')).toBe('admin.demoData.errors.timeout');
    expect(demoDataErrorKey('unknown')).toBe('admin.demoData.errors.generic');
  });
});
