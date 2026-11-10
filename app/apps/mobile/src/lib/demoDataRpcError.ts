// Maps Postgres RPC errors from admin demo-data functions to user-facing i18n keys.
export function demoDataErrorKey(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('demo_operation_busy')) return 'admin.demoData.errors.operationBusy';
  if (m.includes('demo_wipe_blocked_publisher_refs')) {
    return 'admin.demoData.errors.publisherRefs';
  }
  if (m.includes('cannot_wipe_self')) return 'admin.demoData.errors.cannotWipeSelf';
  if (m.includes('forbidden')) return 'admin.demoData.errors.forbidden';
  if (m.includes('not_dev_environment')) return 'admin.demoData.errors.notDevEnvironment';
  if (m.includes('password_required')) return 'admin.demoData.errors.passwordRequired';
  if (m.includes('password_too_short')) return 'admin.demoData.errors.passwordTooShort';
  if (
    m.includes('demo_wipe_lock_timeout') ||
    m.includes('lock timeout') ||
    m.includes('statement timeout') ||
    m.includes('canceling statement') ||
    m.includes('timed out after')
  ) {
    return 'admin.demoData.errors.timeout';
  }
  return 'admin.demoData.errors.generic';
}
