#!/usr/bin/env node
// Version at release time (#2613). app/VERSION no longer moves on every merge;
// a store build first checks that it is ahead of the last shipped version and,
// when it is not, opens one version PR instead of uploading a version that is
// already released.
//
// "Shipped" = the highest `vX.Y.Z` tag: every production release is tagged
// from app/VERSION on the deployed commit (release-version.mjs), and the PROD
// store build ships exactly that tag. Tester builds (`mobile/*` tags) of a
// version above it are pre-release and may repeat with new build numbers.
//
// Commands:
//   gate     (mobile-nightly.yml `resolve`, via mobile-nightly-resolve.mjs)
//            versionGate(): ahead → build; not ahead, or the tags cannot be
//            read → skip tonight with a clear log line (fail-safe: never upload).
//   open-pr  (mobile-nightly.yml `version-pr`, runs only when not ahead)
//            Opens `store-version/<UTC date>` → dev setting app/VERSION to the
//            next patch above max(app/VERSION, latest tag), labels it, and
//            enables auto-merge into the merge queue. At most one per day and
//            never while a version PR is open (store-version/* or the release
//            train's release-train/v*). The next nightly picks the version up.
//
// Env (open-pr): OPERATOR_TOKEN (KC_RELEASE_TRAIN_TOKEN, `release-train`
// environment), GITHUB_REPOSITORY, GITHUB_API_URL (optional), BASE (default
// dev), RUN_URL (optional, for the PR body), NOW (optional ISO time, tests).

import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compareSemver, latestReleaseTag } from './release-version.mjs';

export const VERSION_PR_PREFIXES = ['store-version/', 'release-train/v'];
export const VERSION_PR_LABELS = ['area:ci', 'agent:kc-bot'];

/** "X.Y.Z" → next patch. */
export function nextPatch(version) {
  const m = String(version ?? '').trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) throw new Error(`app/VERSION is not MAJOR.MINOR.PATCH: "${version}"`);
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

/** Tag names from a git/matching-refs/tags/v response. */
export function tagNames(refs) {
  return (refs ?? []).map((r) => String(r.ref ?? '').replace(/^refs\/tags\//, '')).filter(Boolean);
}

/**
 * Is app/VERSION ahead of the last shipped release? `tags` null = the tags
 * could not be read → not ahead (skip, never upload).
 * Returns { ahead, latest, next, reason }; `next` is the version a version PR
 * would set (null when ahead or unknown).
 */
export function versionGate({ version, tags }) {
  const v = String(version ?? '').trim();
  if (!/^\d+\.\d+\.\d+$/.test(v)) {
    return { ahead: false, latest: null, next: null, reason: `app/VERSION is not MAJOR.MINOR.PATCH ("${v}"); skipping the store build` };
  }
  if (!Array.isArray(tags)) {
    return { ahead: false, latest: null, next: null, reason: `could not read the release tags; skipping the store build (fail-safe: never upload a version that may already be released)` };
  }
  const latest = latestReleaseTag(tags);
  if (!latest || compareSemver(v, latest) > 0) {
    return { ahead: true, latest, next: null, reason: `app/VERSION ${v} is ahead of ${latest ?? '(no release tag yet)'}` };
  }
  const base = compareSemver(v, latest) >= 0 ? v : latest.slice(1);
  const next = nextPatch(base);
  return {
    ahead: false,
    latest,
    next,
    reason: `app/VERSION ${v} is not ahead of the released ${latest}; skipping tonight's store build — a version PR sets ${next} and the next run builds it`,
  };
}

/** Should we open a version PR now? `openPrs` = open PRs into base; `todayBranchExists` = store-version/<date> exists. */
export function versionPrDecision({ openPrs, todayBranch, todayBranchExists }) {
  const open = (openPrs ?? []).find((pr) => VERSION_PR_PREFIXES.some((p) => String(pr.head?.ref ?? '').startsWith(p)));
  if (open) return { open: false, reason: `version PR #${open.number} (${open.head.ref}) is already open` };
  if (todayBranchExists) return { open: false, reason: `${todayBranch} already exists (one version PR per day)` };
  return { open: true, reason: `opening ${todayBranch}` };
}

export function versionPrBody({ version, latest, runUrl }) {
  return [
    'Opened by: agent:kc-bot', '',
    '## Summary',
    `Version at release time (#2613): app/VERSION is not ahead of the last shipped release ${latest}, so the store build${runUrl ? ` ${runUrl}` : ''} skipped instead of uploading an already-released version. This PR sets ${version}; the next store build picks it up.`,
    '', '## Changes', `- \`app/VERSION\` → ${version}.`,
    '', '## Mapped to spec', '- Mapped to spec: N/A (version at release time)', '',
    '## Refactor logged', '- NA', '', '## SSOT updated', '- NA', '',
    '## Contributor License Agreement', '',
    '- [x] I have read and agree to the [Contributor License Agreement](../CLA.md).',
  ].join('\n');
}

/** UTC date YYYY-MM-DD of `now`. */
export const utcDate = (now) => new Date(now).toISOString().slice(0, 10);

/**
 * Open the version PR if allowed. `gh(method, path, body, {allow404})` is the
 * REST client, `gql(query, vars)` the GraphQL client.
 */
export async function openVersionPr({ gh, gql, repo, base, version, latest, now, runUrl, log = console.log }) {
  const todayBranch = `store-version/${utcDate(now)}`;
  const openPrs = await listAll((page) => gh('GET', `/repos/${repo}/pulls?state=open&base=${base}&per_page=100&page=${page}`));
  const existing = await gh('GET', `/repos/${repo}/git/ref/heads/${todayBranch}`, null, { allow404: true });
  const decision = versionPrDecision({ openPrs, todayBranch, todayBranchExists: Boolean(existing) });
  log(`Version PR: ${decision.reason}`);
  if (!decision.open) return { opened: false, reason: decision.reason };

  const tip = await gh('GET', `/repos/${repo}/git/ref/heads/${base}`);
  await gh('POST', `/repos/${repo}/git/refs`, { ref: `refs/heads/${todayBranch}`, sha: tip.object.sha });
  const file = await gh('GET', `/repos/${repo}/contents/app/VERSION?ref=${encodeURIComponent(todayBranch)}`);
  const title = `chore(release): set app version ${version}`;
  await gh('PUT', `/repos/${repo}/contents/app/VERSION`, {
    branch: todayBranch, sha: file.sha, message: title, content: Buffer.from(`${version}\n`).toString('base64'),
  });
  const pr = await gh('POST', `/repos/${repo}/pulls`, { title, head: todayBranch, base, body: versionPrBody({ version, latest, runUrl }) });
  await gh('POST', `/repos/${repo}/issues/${pr.number}/labels`, { labels: VERSION_PR_LABELS });
  await gql('mutation($id:ID!){enablePullRequestAutoMerge(input:{pullRequestId:$id,mergeMethod:SQUASH}){clientMutationId}}', { id: pr.node_id });
  log(`Opened version PR #${pr.number} (${pr.html_url}) setting ${version}; auto-merge enabled.`);
  return { opened: true, number: pr.number, url: pr.html_url };
}

async function listAll(fetchPage) {
  const out = [];
  for (let page = 1; page < 20; page++) {
    const items = await fetchPage(page);
    out.push(...items);
    if (items.length < 100) break;
  }
  return out;
}

function client(token) {
  const apiBase = process.env.GITHUB_API_URL || 'https://api.github.com';
  const gh = async (method, path, body, { allow404 = false } = {}) => {
    const res = await fetch(`${apiBase}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (allow404 && res.status === 404) return null;
    if (!res.ok) throw new Error(`${method} ${path} → HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.status === 204 ? null : res.json();
  };
  const gql = async (query, variables) => {
    const data = await gh('POST', '/graphql', { query, variables });
    if (data.errors?.length) throw new Error(`GraphQL: ${data.errors.map((e) => e.message).join('; ')}`);
    return data.data;
  };
  return { gh, gql };
}

async function main([command]) {
  const env = process.env;
  if (command !== 'open-pr') {
    console.error('usage: store-version.mjs open-pr   (the gate runs inside mobile-nightly-resolve.mjs)');
    process.exit(2);
  }
  if (!env.OPERATOR_TOKEN) throw new Error('OPERATOR_TOKEN (KC_RELEASE_TRAIN_TOKEN) is not set');
  const { gh, gql } = client(env.OPERATOR_TOKEN);
  const repo = env.GITHUB_REPOSITORY;
  const base = env.BASE || 'dev';
  const raw = await (await fetch(`${env.GITHUB_API_URL || 'https://api.github.com'}/repos/${repo}/contents/app/VERSION?ref=${base}`, {
    headers: { Accept: 'application/vnd.github.raw+json', Authorization: `Bearer ${env.OPERATOR_TOKEN}`, 'X-GitHub-Api-Version': '2022-11-28' },
  })).text();
  const refs = await gh('GET', `/repos/${repo}/git/matching-refs/tags/v`);
  const gate = versionGate({ version: raw, tags: tagNames(refs) });
  if (gate.ahead) {
    console.log(`${base} is already ahead (${gate.reason}); no version PR needed.`);
    return;
  }
  if (!gate.next) throw new Error(gate.reason);
  const result = await openVersionPr({ gh, gql, repo, base, version: gate.next, latest: gate.latest, now: env.NOW || Date.now(), runUrl: env.RUN_URL });
  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(env.GITHUB_STEP_SUMMARY, `### Version PR\n\n${result.opened ? `Opened [#${result.number}](${result.url}) setting ${gate.next}.` : result.reason}\n`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.log(`::error::${err.message}`);
    process.exit(1);
  });
}
