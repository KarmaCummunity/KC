#!/usr/bin/env node
// Read-only merge-group freshness checks. Never cancel a run or turn stale work into acceptance.
import { pathToFileURL } from 'node:url';

export function classifyFreshness(event, refs) {
  if (event.name !== 'merge_group') return { status: 'not-applicable' };
  const branch = String(event.baseRef ?? '').replace(/^refs\/heads\//, '');
  const headRef = String(event.headRef ?? '').replace(/^refs\/heads\//, '');
  if (!branch || !/^[0-9a-f]{40}$/.test(event.sha ?? '') ||
      !headRef.startsWith(`gh-readonly-queue/${branch}/pr-`) ||
      !/\/pr-\d+-[0-9a-f]{40}$/.test(headRef)) {
    return { status: 'unverifiable', reason: 'missing or invalid merge-group identity' };
  }
  if (!Array.isArray(refs)) return { status: 'unverifiable', reason: 'queue lookup was not a list' };
  const matches = refs.filter((r) => r?.ref === `refs/heads/${headRef}`);
  if (matches.length > 1) return { status: 'unverifiable', reason: 'duplicate queue identity' };
  if (matches.length === 0 || matches[0]?.object?.sha !== event.sha) {
    return { status: 'stale', reason: 'exact merge-group ref no longer points at this SHA' };
  }
  return { status: 'current' };
}

export async function checkFreshness(env, gh) {
  const event = { name: env.GITHUB_EVENT_NAME, baseRef: env.MERGE_GROUP_BASE_REF,
    headRef: env.MERGE_GROUP_HEAD_REF, sha: env.MERGE_GROUP_HEAD_SHA };
  if (event.name !== 'merge_group') return classifyFreshness(event);
  const branch = String(event.baseRef ?? '').replace(/^refs\/heads\//, '');
  if (!env.GITHUB_REPOSITORY || !branch) return { status: 'unverifiable', reason: 'missing repository or base' };
  // Only the queue refs are read. A stale / missing / failed lookup never releases a green gate.
  try {
    const refs = await gh(`/repos/${env.GITHUB_REPOSITORY}/git/matching-refs/heads/gh-readonly-queue/${encodeURIComponent(branch)}/`);
    return classifyFreshness(event, refs);
  } catch {
    return { status: 'unverifiable', reason: 'queue lookup failed' };
  }
}

export async function main(env = process.env) {
  const verdict = await checkFreshness(env, async (path) => {
    if (!env.GITHUB_TOKEN) throw new Error('missing token');
    const res = await fetch(`https://api.github.com${path}`, {
      headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28' }, signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error('queue lookup failed');
    return res.json();
  });
  if (verdict.status === 'current' || verdict.status === 'not-applicable') {
    console.log(`queue freshness: ${verdict.status}`);
    return 0;
  }
  console.error(`::error::queue freshness: ${verdict.status}: ${verdict.reason}. No current-candidate acceptance.`);
  return 1;
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then((code) => { process.exitCode = code; }).catch(() => { process.exitCode = 1; });
}
