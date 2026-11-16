// FR-ADMIN-031 — which line of `admin.demoData.errors` explains a failed demo-data action.
import { isDemoDataError, type DemoDataErrorCode } from '@kc/domain';

export type DemoDataErrorKey =
  | 'generic' | 'forbidden' | 'notDevEnvironment' | 'cannotWipeSelf' | 'passwordRequired'
  | 'passwordTooShort' | 'operationBusy' | 'notInstalled' | 'timeout' | 'incomplete';

const KEY_BY_CODE: Readonly<Record<DemoDataErrorCode, DemoDataErrorKey>> = {
  forbidden: 'forbidden',
  not_dev_environment: 'notDevEnvironment',
  cannot_wipe_self: 'cannotWipeSelf',
  password_required: 'passwordRequired',
  password_too_short: 'passwordTooShort',
  demo_operation_busy: 'operationBusy',
  not_installed: 'notInstalled',
  timeout: 'timeout',
  incomplete: 'incomplete',
  unknown: 'generic',
};

/** The error line for `err`; anything that is not a DemoDataError is the generic line. */
export function demoDataErrorKey(err: unknown): DemoDataErrorKey {
  return isDemoDataError(err) ? KEY_BY_CODE[err.code] : 'generic';
}
