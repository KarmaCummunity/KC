// Mapped to spec: FR-ADMIN-031 — every refusal of the demo-data tools has its own explanation.
import { describe, expect, it } from 'vitest';
import { DemoDataError } from '@kc/domain';
import { bothLocaleBundles } from '../../../i18n/useLocaleBundle';
import { demoDataErrorKey } from '../demoDataErrorKey';

describe('demoDataErrorKey', () => {
  it('maps each refusal to its line', () => {
    expect(demoDataErrorKey(new DemoDataError('not_dev_environment'))).toBe('notDevEnvironment');
    expect(demoDataErrorKey(new DemoDataError('cannot_wipe_self'))).toBe('cannotWipeSelf');
    expect(demoDataErrorKey(new DemoDataError('demo_operation_busy'))).toBe('operationBusy');
    expect(demoDataErrorKey(new DemoDataError('not_installed'))).toBe('notInstalled');
    expect(demoDataErrorKey(new DemoDataError('unknown'))).toBe('generic');
    expect(demoDataErrorKey(new Error('network'))).toBe('generic');
  });

  it('every line exists in both languages', () => {
    const { he, en } = bothLocaleBundles();
    for (const err of ['forbidden', 'password_required', 'password_too_short', 'timeout', 'incomplete'] as const) {
      const key = demoDataErrorKey(new DemoDataError(err));
      expect(he.admin.demoData.errors[key]).toBeTruthy();
      expect(en.admin.demoData.errors[key]).toBeTruthy();
    }
  });
});
