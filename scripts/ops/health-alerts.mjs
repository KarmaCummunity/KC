import { safeHealthImpact } from './health-impacts.mjs';

// Health report → alert actions (G42, D68). Pure functions only: no I/O, so the whole
// alerting policy is unit-tested in health-alerts.test.mjs.
//
// One alert per (environment, check). A failing check opens an alert or
// refreshes it when its state changed; a check that is `ok` again, or no longer reported,
// resolves it. Skipped checks retain existing incidents. Channels (GitHub issues today, WhatsApp once live) only execute the plan.

const FAILING = new Set(['failing', 'alert', 'error']);

/** Adapt the current database contract; retain legacy rows for old report callers. */
export function normalizeHealthRow(row) {
  if (row.check_name === undefined) return row;
  return { ...row, check_key: row.check_name, value: row.measured, threshold: row.max_allowed, area: 'platform', severity: 'warning', detail: 'Diagnostic detail withheld; inspect the authenticated health report' };
}

/** Preserve bigint strings exactly; reject numbers already rounded by JSON decoding. */
function isCount(value) {
  return typeof value === 'number' ? Number.isSafeInteger(value) && value >= 0 : typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) && BigInt(value) <= 9223372036854775807n;
}

/** Fail as one unreadable report, before any recovery actions can be planned. */
export function validateHealthReport(report) {
  if (!Array.isArray(report)) throw new Error('invalid health report shape');
  const names = new Set();
  for (const input of report) {
    if (!input || typeof input !== 'object') throw new Error('invalid health report row');
    const row = normalizeHealthRow(input);
    if (typeof row.check_key !== 'string' || !/^[a-z0-9_]+$/.test(row.check_key) || names.has(row.check_key)) throw new Error('invalid health check identity');
    names.add(row.check_key);
    if (!['ok', 'failing', 'skipped', 'alert', 'error'].includes(row.status)) throw new Error('invalid health check status');
    if (input.check_name !== undefined) {
      if (!['ok', 'failing', 'skipped'].includes(row.status) || (row.status !== 'skipped' && !isCount(row.value)) || !isCount(row.threshold) || typeof row.failure_means !== 'string') throw new Error('invalid current health report fields');
    } else {
      const unavailable = row.check_key === 'health_report_unavailable' && row.status === 'error' && row.area === 'platform' && row.severity === 'critical' && row.value === null && row.threshold === null;
      if (typeof row.area !== 'string' || !row.area || !['warning', 'critical'].includes(row.severity) || typeof row.detail !== 'string' || (!unavailable && (!isCount(row.value) || !isCount(row.threshold)))) throw new Error('invalid legacy health report fields');
    }
  }
  return report;
}

/** Hidden marker that ties an alert to its (env, check) pair across runs. */
export function alertMarker(env, checkKey) {
  return `<!-- ops-check:${env}:${checkKey} -->`;
}

/** Hidden fingerprint of what the alert last showed; a change means "update it". */
function stateMarker(row) {
  return `<!-- ops-state:${JSON.stringify([row.status, row.value, row.threshold, row.severity, safeHealthImpact(row.check_key)])} -->`;
}

/** Title and body of the alert for one failing check. Counts and job names only. */
export function renderAlert(env, row, runbookUrl) {
  row = normalizeHealthRow(row);
  const title = `[ops][${env}] ${row.check_key} — ${row.status}`;
  const body = [
    alertMarker(env, row.check_key),
    stateMarker(row),
    `**${row.check_key}** (platform) is **${row.status}** on **${env}**.`,
    '',
    '| Severity | Value | Threshold | Detail |',
    '| --- | --- | --- | --- |',
    `| ${row.severity} | ${row.value ?? '–'} | ${row.threshold ?? '–'} | ${row.check_key === 'health_report_unavailable' ? 'The health report could not be read; inspect the authenticated workflow' : 'Diagnostic detail withheld; inspect the authenticated health report'} |`,
    '',
    `Failure means: ${safeHealthImpact(row.check_key)}`, '',
    `What to do: ${runbookUrl}`,
    '',
    '_Opened by the hourly ops health monitor. It closes itself once the check is ok again._',
  ].join('\n');
  return { title, body, severity: row.severity };
}

/**
 * Plans what the channels must do for one environment.
 * @param {Array<object>} report rows of ops.run_health_checks()
 * @param {Array<{id:number|string, body:string}>} openAlerts alerts already open (any env)
 * @returns {Array<{type:'open'|'update'|'resolve', checkKey:string, alertId?:any, alert?:object, reason?:string}>}
 */
export function planAlertActions(env, report, openAlerts, runbookUrl) {
  validateHealthReport(report);
  const mine = new Map();
  for (const alert of openAlerts) {
    const match = alert.body?.match(/<!-- ops-check:([^:]+):([a-z0-9_]+) -->/);
    if (match && match[1] === env) mine.set(match[2], alert);
  }

  const actions = [];
  const reported = new Set();
  for (const input of report) {
    const row = normalizeHealthRow(input);
    reported.add(row.check_key);
    const existing = mine.get(row.check_key);
    if (FAILING.has(row.status)) {
      const alert = renderAlert(env, row, runbookUrl);
      if (!existing) actions.push({ type: 'open', checkKey: row.check_key, alert });
      else if (!existing.body.includes(stateMarker(row))) {
        actions.push({ type: 'update', checkKey: row.check_key, alertId: existing.id, alert });
      }
    } else if (row.status === 'ok' && existing) {
      actions.push({ type: 'resolve', checkKey: row.check_key, alertId: existing.id, reason: 'the check is ok again' });
    }
  }

  // A check that was disabled or removed can no longer recover; close its alert.
  const unavailable = report.some((row) => row.check_key === 'health_report_unavailable');
  for (const [checkKey, alert] of mine) {
    if (!unavailable && !reported.has(checkKey)) {
      actions.push({ type: 'resolve', checkKey, alertId: alert.id, reason: 'the check is no longer reported' });
    }
  }
  return actions;
}

/** The single row reported when the health report itself cannot be read. */
export function unavailableReport(reason) {
  // Transport errors may contain response bodies, URLs or credentials. Publish only
  // a small allowlist of machine-generated HTTP classifications, never freeform prose.
  const safeReason = /^(query|project status) HTTP [1-5][0-9]{2}$/.test(reason) ? reason : 'request or report validation failed';
  return [{
    check_key: 'health_report_unavailable',
    area: 'platform',
    severity: 'critical',
    status: 'error',
    value: null,
    threshold: null,
    detail: `the health report could not be read (${safeReason})`,
  }];
}
