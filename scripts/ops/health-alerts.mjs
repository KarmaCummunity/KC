// Health report → alert actions (G42, D68). Pure functions only: no I/O, so the whole
// alerting policy is unit-tested in health-alerts.test.mjs.
//
// One alert per (environment, check). A failing check (`alert` or `error`) opens an alert or
// refreshes it when its state changed; a check that is `ok` again, or no longer reported,
// resolves it. Channels (GitHub issues today, WhatsApp once live) only execute the plan.

const FAILING = new Set(['alert', 'error']);

/** Hidden marker that ties an alert to its (env, check) pair across runs. */
export function alertMarker(env, checkKey) {
  return `<!-- ops-check:${env}:${checkKey} -->`;
}

/** Hidden fingerprint of what the alert last showed; a change means "update it". */
function stateMarker(row) {
  return `<!-- ops-state:${row.status}|${row.value ?? ''}|${row.detail ?? ''} -->`;
}

/** Title and body of the alert for one failing check. Counts and job names only. */
export function renderAlert(env, row, runbookUrl) {
  const title = `[ops][${env}] ${row.check_key} — ${row.status}`;
  const body = [
    alertMarker(env, row.check_key),
    stateMarker(row),
    `**${row.check_key}** (${row.area}) is **${row.status}** on **${env}**.`,
    '',
    '| Severity | Value | Threshold | Detail |',
    '| --- | --- | --- | --- |',
    `| ${row.severity} | ${row.value ?? '–'} | ${row.threshold ?? '–'} | ${row.detail ?? '–'} |`,
    '',
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
  const mine = new Map();
  for (const alert of openAlerts) {
    const match = alert.body?.match(/<!-- ops-check:([^:]+):([a-z0-9_]+) -->/);
    if (match && match[1] === env) mine.set(match[2], alert);
  }

  const actions = [];
  const reported = new Set();
  for (const row of report) {
    reported.add(row.check_key);
    const existing = mine.get(row.check_key);
    if (FAILING.has(row.status)) {
      const alert = renderAlert(env, row, runbookUrl);
      if (!existing) actions.push({ type: 'open', checkKey: row.check_key, alert });
      else if (!existing.body.includes(stateMarker(row))) {
        actions.push({ type: 'update', checkKey: row.check_key, alertId: existing.id, alert });
      }
    } else if (existing) {
      actions.push({ type: 'resolve', checkKey: row.check_key, alertId: existing.id, reason: 'the check is ok again' });
    }
  }

  // A check that was disabled or removed can no longer recover; close its alert.
  for (const [checkKey, alert] of mine) {
    if (!reported.has(checkKey)) {
      actions.push({ type: 'resolve', checkKey, alertId: alert.id, reason: 'the check is no longer reported' });
    }
  }
  return actions;
}

/** The single row reported when the health report itself cannot be read. */
export function unavailableReport(reason) {
  return [{
    check_key: 'health_report_unavailable',
    area: 'platform',
    severity: 'critical',
    status: 'error',
    value: null,
    threshold: null,
    detail: `the health report could not be read (${reason})`,
  }];
}
