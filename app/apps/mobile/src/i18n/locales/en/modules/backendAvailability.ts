// The degrade rule (docs/db/app-migration-playbook.md): copy for a call to a backend object that
// is not deployed yet. Actions show `notAvailableYet`; lists show their empty state with
// `listUnavailable`. Consumed by lib/backendAvailability.ts.
export const backendAvailabilityEn = {
  notAvailableTitle: 'Not available yet',
  notAvailableYet: 'This option is not available yet. Please check back soon.',
  listUnavailable: 'This content is not available yet.',
} as const;
