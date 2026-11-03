import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runMonitor, supabaseManagement } from './health-monitor.mjs';
import { githubIssueChannel } from './github-issue-channel.mjs';

const RUNBOOK = 'https://example.test/runbook';

/** In-memory channel that records what it was asked to do. */
function fakeChannel(open = []) {
  const applied = [];
  return {
    name: 'fake',
    applied,
    listOpen: async () => open,
    apply: async (action) => {
      applied.push(action);
      return `${action.type} ${action.checkKey}`;
    },
  };
}

const supabaseStub = ({ status = 'ACTIVE_HEALTHY', report = [], fail } = {}) => ({
  projectStatus: async () => status,
  healthReport: async () => {
    if (fail) throw new Error(fail);
    return report;
  },
});

test('a paused project is skipped without touching any channel', async () => {
  const channel = fakeChannel();
  const summary = await runMonitor({ env: 'prod', supabase: supabaseStub({ status: 'INACTIVE' }), channels: [channel], runbookUrl: RUNBOOK });
  assert.equal(summary.skipped, 'project status INACTIVE');
  assert.equal(channel.applied.length, 0);
});

test('failing checks are delivered to every channel', async () => {
  const report = [
    { check_key: 'rides_bookings_unconfirmed', area: 'rides', severity: 'warning', status: 'alert', value: 2, threshold: 0, detail: 'd' },
    { check_key: 'matching_errors', area: 'platform', severity: 'warning', status: 'ok', value: 0, threshold: 0, detail: 'd' },
  ];
  const a = fakeChannel();
  const b = fakeChannel();
  const summary = await runMonitor({ env: 'dev', supabase: supabaseStub({ report }), channels: [a, b], runbookUrl: RUNBOOK });
  assert.deepEqual(summary.failing, ['rides_bookings_unconfirmed=alert']);
  assert.deepEqual(a.applied.map((x) => x.type), ['open']);
  assert.deepEqual(b.applied.map((x) => x.type), ['open']);
});

test('an unreadable report is raised as a critical alert instead of failing silently', async () => {
  const channel = fakeChannel();
  const summary = await runMonitor({ env: 'dev', supabase: supabaseStub({ fail: 'query HTTP 401' }), channels: [channel], runbookUrl: RUNBOOK });
  assert.deepEqual(summary.failing, ['health_report_unavailable=error']);
  assert.equal(channel.applied[0].alert.severity, 'critical');
});

test('dry run plans but applies nothing', async () => {
  const report = [{ check_key: 'notifications_backlog', area: 'platform', severity: 'critical', status: 'alert', value: 4, threshold: 0, detail: 'd' }];
  const channel = fakeChannel();
  const summary = await runMonitor({ env: 'dev', supabase: supabaseStub({ report }), channels: [channel], runbookUrl: RUNBOOK, dryRun: true });
  assert.deepEqual(summary.results, ['fake: would open notifications_backlog']);
  assert.equal(channel.applied.length, 0);
});

test('the management client posts the read-only report query', async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    return { ok: true, json: async () => (url.endsWith('/database/query') ? [] : { status: 'ACTIVE_HEALTHY' }) };
  };
  const client = supabaseManagement({ projectRef: 'ref123', token: 'tkn', fetchImpl });
  assert.equal(await client.projectStatus(), 'ACTIVE_HEALTHY');
  await client.healthReport();
  assert.equal(calls[1].url, 'https://api.supabase.com/v1/projects/ref123/database/query');
  assert.deepEqual(JSON.parse(calls[1].init.body), { query: 'select * from ops.run_health_checks()' });
});

test('the GitHub channel creates missing labels, assigns the PM and closes on resolve', async () => {
  const calls = [];
  const call = async (path, init = {}) => {
    calls.push(`${init.method ?? 'GET'} ${path}`);
    if (path.startsWith('/labels/')) return null; // label missing → must be created
    if (path === '/issues' && init.method === 'POST') return { number: 42, ...JSON.parse(init.body) };
    return {};
  };
  const channel = githubIssueChannel({ repo: 'o/r', token: 't', env: 'prod', assignee: 'pm', call });
  const opened = await channel.apply({ type: 'open', checkKey: 'k', alert: { title: 'T', body: 'B', severity: 'critical' } });
  assert.equal(opened, 'opened #42');
  assert.deepEqual(calls.filter((c) => c.startsWith('POST /labels')).length, 3);
  const resolved = await channel.apply({ type: 'resolve', checkKey: 'k', alertId: 42, reason: 'ok again' });
  assert.equal(resolved, 'resolved #42');
  assert.ok(calls.includes('POST /issues/42/comments'));
  assert.ok(calls.includes('PATCH /issues/42'));
});
