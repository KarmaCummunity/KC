import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertMarker, planAlertActions, renderAlert, unavailableReport } from './health-alerts.mjs';

const RUNBOOK = 'https://example.test/runbook';
const row = (check_key, status, overrides = {}) => ({
  check_key, area: 'rides', severity: 'warning', status, value: status === 'ok' ? 0 : 3, threshold: 0,
  detail: `${check_key} detail`, ...overrides,
});
const openAlert = (id, env, checkKey, shownRow) => ({
  id,
  body: shownRow ? renderAlert(env, shownRow, RUNBOOK).body : `${alertMarker(env, checkKey)}\nold body`,
});

test('a failing check without an alert opens one', () => {
  const actions = planAlertActions('dev', [row('rides_open_after_departure', 'alert')], [], RUNBOOK);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, 'open');
  assert.match(actions[0].alert.title, /^\[ops\]\[dev\] rides_open_after_departure — alert$/);
  assert.ok(actions[0].alert.body.includes(alertMarker('dev', 'rides_open_after_departure')));
});

test('an error counts as failing, like an alert', () => {
  const actions = planAlertActions('prod', [row('matching_errors', 'error')], [], RUNBOOK);
  assert.deepEqual(actions.map((a) => a.type), ['open']);
});

test('an unchanged failing check is left alone (no hourly churn)', () => {
  const failing = row('rides_bookings_unconfirmed', 'alert');
  const actions = planAlertActions('dev', [failing], [openAlert(7, 'dev', null, failing)], RUNBOOK);
  assert.deepEqual(actions, []);
});

test('a failing check whose value changed updates its alert', () => {
  const shown = row('rides_bookings_unconfirmed', 'alert', { value: 2 });
  const now = row('rides_bookings_unconfirmed', 'alert', { value: 5 });
  const actions = planAlertActions('dev', [now], [openAlert(7, 'dev', null, shown)], RUNBOOK);
  assert.deepEqual(actions.map((a) => [a.type, a.alertId]), [['update', 7]]);
});

test('a recovered check resolves its alert', () => {
  const actions = planAlertActions('dev', [row('notifications_backlog', 'ok')], [openAlert(9, 'dev', 'notifications_backlog')], RUNBOOK);
  assert.deepEqual(actions.map((a) => [a.type, a.alertId]), [['resolve', 9]]);
});

test('a check no longer reported resolves its alert', () => {
  const actions = planAlertActions('dev', [], [openAlert(4, 'dev', 'removed_check')], RUNBOOK);
  assert.equal(actions[0].type, 'resolve');
  assert.match(actions[0].reason, /no longer reported/);
});

test('alerts of the other environment are never touched', () => {
  const actions = planAlertActions('dev', [row('notifications_backlog', 'ok')], [openAlert(9, 'prod', 'notifications_backlog')], RUNBOOK);
  assert.deepEqual(actions, []);
});

test('an ok check with no alert does nothing', () => {
  assert.deepEqual(planAlertActions('dev', [row('matching_errors', 'ok')], [], RUNBOOK), []);
});

test('the alert body carries the report fields and the runbook link', () => {
  const { body, severity } = renderAlert('prod', row('scheduled_jobs_failed', 'alert', { severity: 'critical' }), RUNBOOK);
  assert.equal(severity, 'critical');
  assert.ok(body.includes('| critical | 3 | 0 | scheduled_jobs_failed detail |'));
  assert.ok(body.includes(RUNBOOK));
});

test('an unreadable report becomes one critical error row', () => {
  const [only, ...rest] = unavailableReport('query HTTP 401');
  assert.equal(rest.length, 0);
  assert.equal(only.check_key, 'health_report_unavailable');
  assert.equal(only.severity, 'critical');
  assert.equal(only.status, 'error');
  assert.match(only.detail, /HTTP 401/);
});
