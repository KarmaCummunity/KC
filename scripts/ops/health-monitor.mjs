#!/usr/bin/env node
// Hourly operational health monitor (G42, D68, D69; docs/architecture/target.md §5.2).
//
// Reads ops.run_health_checks() from one Supabase project through the Management API and
// routes the result to the alert channels: a failing check opens an alert (a GitHub issue
// assigned to the PM, so they get an email), a recovered check closes it. The query is
// read-only by construction (see migration 0463). A paused project is skipped; an
// unreadable report is itself raised as a critical alert, so the monitor never goes blind
// silently.
//
// Run by .github/workflows/ops-health.yml. Env: OPS_ENV (dev | prod), SUPABASE_ACCESS_TOKEN,
// SUPABASE_PROJECT_REF, GITHUB_TOKEN, GITHUB_REPOSITORY, OPS_ALERT_ASSIGNEE (optional).
// `--dry-run` (or OPS_DRY_RUN=true) prints the planned actions and changes nothing.

import { pathToFileURL } from 'node:url';
import { planAlertActions, unavailableReport } from './health-alerts.mjs';
import { githubIssueChannel } from './github-issue-channel.mjs';

const REPORT_SQL = 'select * from ops.run_health_checks()';

/** Supabase Management API client; `fetchImpl` is injectable for tests. */
export function supabaseManagement({ projectRef, token, fetchImpl = fetch }) {
  const base = `https://api.supabase.com/v1/projects/${projectRef}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  return {
    async projectStatus() {
      const res = await fetchImpl(base, { headers });
      if (!res.ok) throw new Error(`project status HTTP ${res.status}`);
      return (await res.json()).status ?? 'UNKNOWN';
    },
    async healthReport() {
      const res = await fetchImpl(`${base}/database/query`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: REPORT_SQL }),
      });
      if (!res.ok) throw new Error(`query HTTP ${res.status}`);
      return res.json();
    },
  };
}

/**
 * One monitoring pass for one environment. Returns a summary for the job log.
 * @param {{env:string, supabase:object, channels:object[], runbookUrl:string, dryRun?:boolean}} deps
 */
export async function runMonitor({ env, supabase, channels, runbookUrl, dryRun = false }) {
  let report;
  try {
    const status = await supabase.projectStatus();
    if (status !== 'ACTIVE_HEALTHY') return { env, skipped: `project status ${status}` };
    report = await supabase.healthReport();
  } catch (err) {
    report = unavailableReport(err.message);
  }

  const results = [];
  for (const channel of channels) {
    const actions = planAlertActions(env, report, await channel.listOpen(), runbookUrl);
    for (const action of actions) {
      results.push(dryRun ? `${channel.name}: would ${action.type} ${action.checkKey}` : `${channel.name}: ${await channel.apply(action)}`);
    }
  }
  const failing = report.filter((r) => r.status !== 'ok').map((r) => `${r.check_key}=${r.status}`);
  return { env, checks: report.length, failing, results };
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main(args) {
  const env = requiredEnv('OPS_ENV');
  const repo = requiredEnv('GITHUB_REPOSITORY');
  const summary = await runMonitor({
    env,
    dryRun: args.includes('--dry-run') || process.env.OPS_DRY_RUN === 'true',
    runbookUrl: `https://github.com/${repo}/blob/dev/docs/SSOT/OPERATOR_RUNBOOK.md#ops-health-alerts`,
    supabase: supabaseManagement({
      projectRef: requiredEnv('SUPABASE_PROJECT_REF'),
      token: requiredEnv('SUPABASE_ACCESS_TOKEN'),
    }),
    channels: [
      githubIssueChannel({ repo, token: requiredEnv('GITHUB_TOKEN'), env, assignee: process.env.OPS_ALERT_ASSIGNEE }),
    ],
  });
  console.log(JSON.stringify(summary, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
