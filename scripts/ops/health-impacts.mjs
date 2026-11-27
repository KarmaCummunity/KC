// Fixed, data-free operator impact summaries, grounded in
// supabase/schemas/95_platform/080_health_checks.sql and migrations 0057/0076. Do not interpolate report prose.
export const HEALTH_IMPACTS = Object.freeze({
  import_provider_budget: 'Post imports are approaching the configured daily model-call budget; exhaustion makes imports fall back to manual entry.',
  whatsapp_outbound_backlog: 'Queued WhatsApp messages have waited beyond the configured delivery window while the channel is enabled.',
  outbox_backlog: 'Background event processing is delayed; dependent side effects may arrive late.',
  outbox_exhausted: 'Some background events repeatedly fail and remain unprocessed.',
  outbox_stale_claims: 'Background event processing was not confirmed; workers may be interrupted.',
  jobs_failing: 'At least one enabled scheduled job most recently failed.',
  jobs_late: 'At least one enabled scheduled job has not succeeded within its configured time window.',
  jobs_unscheduled: 'At least one enabled scheduled job is missing from the active scheduler.',
  partitions_next_month: 'A log partition for next month is missing; new rows may use the default partition.',
  default_partition_rows: 'Some log rows are in default partitions, preventing normal whole-partition retention.',
  push_retries: 'Push notifications remain undelivered after repeated attempts.',
  counter_drift: 'Counter reconciliation found and repaired inconsistent totals.',
  warnings: 'Operational warnings were recorded and need authenticated investigation.',
  edge_function_responses: 'Database-started worker requests failed or returned error responses; dependent background work may be interrupted.',
});

export function safeHealthImpact(checkKey) {
  return Object.hasOwn(HEALTH_IMPACTS, checkKey)
    ? HEALTH_IMPACTS[checkKey]
    : 'The measured condition exceeds its configured limit. This check has no reviewed impact mapping; inspect the authenticated report and runbook.';
}
