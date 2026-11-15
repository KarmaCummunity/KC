// The degrade rule (docs/db/app-migration-playbook.md): copy for a call to a backend object that
// is not deployed yet. Actions show `notAvailableYet`; lists show their empty state with
// `listUnavailable`. Consumed by lib/backendAvailability.ts.
export const backendAvailabilityHe = {
  notAvailableTitle: 'עדיין לא זמין',
  notAvailableYet: 'האפשרות הזו עדיין לא זמינה. כדאי לנסות שוב בקרוב.',
  listUnavailable: 'התוכן הזה עדיין לא זמין.',
} as const;
