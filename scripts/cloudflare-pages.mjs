#!/usr/bin/env node
// Cloudflare Pages API calls for the prod web deploy and its rollback.
//
//   current <branch>   Before a prod deploy: record the deployment that serves
//                      production now (`previous_id`, `previous_commit`) and
//                      fail unless the project's production branch is <branch>
//                      (otherwise `wrangler pages deploy --branch=<branch>`
//                      would create a preview and leave production untouched).
//   rollback <id>      Point production back at deployment <id>.
//
// Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, CF_PAGES_PROJECT.
// Outputs go to stdout and, when set, $GITHUB_OUTPUT.

import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const API = 'https://api.cloudflare.com/client/v4';

/** Call the Pages API for `project`; throws with Cloudflare's own error text. */
export async function pagesApi({ env, fetch, path = '', method = 'GET' }) {
  const url = `${API}/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/${env.CF_PAGES_PROJECT}${path}`;
  const res = await fetch(url, { method, headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) {
    const reason = (body.errors ?? []).map((e) => e.message).join('; ') || `HTTP ${res.status}`;
    throw new Error(`Cloudflare Pages ${method} ${path || '(project)'} failed: ${reason}`);
  }
  return body.result;
}

/** The production deployment serving now, after checking the production branch. */
export function currentProduction(project, expectedBranch) {
  if (project.production_branch !== expectedBranch) {
    throw new Error(`Pages project production branch is "${project.production_branch}", expected "${expectedBranch}"`);
  }
  const live = project.canonical_deployment;
  return {
    previous_id: live?.id ?? '',
    previous_commit: live?.deployment_trigger?.metadata?.commit_hash ?? '',
  };
}

function emit(values) {
  const lines = Object.entries(values).map(([k, v]) => `${k}=${v}`);
  console.log(lines.join('\n'));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
}

async function main([command, arg]) {
  const env = process.env;
  const fetch = globalThis.fetch;
  if (command === 'current' && arg) {
    const live = currentProduction(await pagesApi({ env, fetch }), arg);
    if (!live.previous_id) console.log('::warning::no production deployment yet; a failed deploy cannot be rolled back');
    emit(live);
  } else if (command === 'rollback' && /^[0-9a-f-]{36}$/.test(arg ?? '')) {
    const result = await pagesApi({ env, fetch, method: 'POST', path: `/deployments/${arg}/rollback` });
    console.log(`Production now serves deployment ${result?.id ?? arg}.`);
  } else {
    console.error('usage: cloudflare-pages.mjs current <production-branch> | rollback <deployment-id>');
    process.exit(2);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.log(`::error::${err.message}`);
    process.exit(1);
  });
}
