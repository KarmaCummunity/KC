#!/usr/bin/env node
/**
 * Read-only App Store Connect + Google Play status report (#2608).
 * ASC: GET only. Play: create edit → list tracks → DELETE edit (never commit).
 * Secrets are never logged. JWT / access tokens stay out of stdout.
 *
 * Env (workflow): ASC_API_KEY_P8, ASC_API_KEY_ID, ASC_API_KEY_ISSUER_ID, KC_ASC_APP_ID,
 * GOOGLE_PLAY_SERVICE_ACCOUNT_JSON, optional KC_STORE_STATUS_ISSUE, GITHUB_TOKEN,
 * GITHUB_REPOSITORY, GITHUB_STEP_SUMMARY.
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  createAscJwt,
  fetchAscStatus,
  fetchPlayAccessToken,
  fetchPlayStatus,
  stateFingerprint,
  formatSummaryMarkdown,
  shouldComment,
  parseFingerprintFromComments,
} from './store-status-api.mjs';

export * from './store-status-api.mjs';

function required(name, value) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

/**
 * Collect status, write JSON + step summary, optionally comment on change.
 * `fetchImpl` is injectable; Play OAuth uses the same fetch (not store-guarded).
 */
export async function collectStoreStatus({
  env = process.env,
  fetchImpl = fetch,
  now = () => new Date().toISOString(),
} = {}) {
  const errors = [];
  let asc = null;
  let play = null;

  try {
    const jwt = createAscJwt({
      keyId: required('ASC_API_KEY_ID', env.ASC_API_KEY_ID),
      issuerId: required('ASC_API_KEY_ISSUER_ID', env.ASC_API_KEY_ISSUER_ID),
      privateKeyPem: required('ASC_API_KEY_P8', env.ASC_API_KEY_P8),
    });
    asc = await fetchAscStatus({
      appId: required('KC_ASC_APP_ID', env.KC_ASC_APP_ID),
      jwt,
      fetchImpl,
    });
  } catch (e) {
    errors.push(`ASC: ${e.message}`);
  }

  try {
    const sa = JSON.parse(required('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON', env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON));
    if (sa.type !== 'service_account' || !sa.client_email || !sa.private_key) {
      throw new Error('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not a service account');
    }
    const accessToken = await fetchPlayAccessToken(sa, fetchImpl);
    play = await fetchPlayStatus({ accessToken, fetchImpl });
  } catch (e) {
    errors.push(`Play: ${e.message}`);
  }

  const report = { collectedAt: now(), asc, play, errors, fingerprint: null };
  report.fingerprint = stateFingerprint(report);
  return report;
}

export async function maybeCommentOnIssue({
  report,
  issueNumber,
  repo,
  token,
  fetchImpl = fetch,
}) {
  if (!issueNumber) return { commented: false, reason: 'KC_STORE_STATUS_ISSUE unset' };
  const api = `https://api.github.com/repos/${repo}`;
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const list = await fetchImpl(`${api}/issues/${issueNumber}/comments?per_page=20&direction=desc`, { headers });
  const comments = list.ok ? await list.json() : [];
  const prev = parseFingerprintFromComments(comments);
  if (!shouldComment(prev, report.fingerprint)) {
    return { commented: false, reason: 'unchanged', fingerprint: report.fingerprint };
  }
  const body = [
    `<!-- store-status-fp:${report.fingerprint} -->`,
    formatSummaryMarkdown(report),
    report.errors.length ? `\n_Errors:_ ${report.errors.join('; ')}` : '',
  ].join('\n');
  const res = await fetchImpl(`${api}/issues/${issueNumber}/comments`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error(`GitHub comment failed (HTTP ${res.status})`);
  return { commented: true, fingerprint: report.fingerprint };
}

async function main() {
  const env = process.env;
  const report = await collectStoreStatus({ env });
  const outPath = env.STORE_STATUS_OUT || 'store-status.json';
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  const md = formatSummaryMarkdown(report);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, md);
  else console.log(md);
  // Never print secrets; errors are safe classification strings only.
  for (const err of report.errors) console.log(`::warning::${err}`);
  if (env.KC_STORE_STATUS_ISSUE) {
    const result = await maybeCommentOnIssue({
      report,
      issueNumber: env.KC_STORE_STATUS_ISSUE,
      repo: required('GITHUB_REPOSITORY', env.GITHUB_REPOSITORY),
      token: required('GITHUB_TOKEN', env.GITHUB_TOKEN),
    });
    console.log(result.commented ? 'Commented on status issue (state changed).' : `No issue comment (${result.reason}).`);
  }
  if (report.errors.length && !report.asc && !report.play) process.exitCode = 1;
}

const isDirect = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirect) {
  main().catch((e) => {
    console.log(`::error::store-status failed: ${e.message}`);
    process.exitCode = 1;
  });
}
