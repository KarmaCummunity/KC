#!/usr/bin/env node
// Keep the EAS cloud build's SENTRY_AUTH_TOKEN equal to the GitHub
// `mobile-store` secret, for the one EAS environment this build uses.
//
// Why: Android AABs build on EAS cloud, which never sees the runner env, so
// the Sentry Gradle upload reads SENTRY_AUTH_TOKEN from the EAS environment.
// play-internal.yml pins SENTRY_ORG/PROJECT/URL from `mobile-store` vars into
// the profile env, so when the org moved to kc-z0 (14 Nov) the stale EAS
// token got `sentry reported an error: You do not have permission to perform
// this action. (http status: 403)` and every Android build failed in
// `createBundleReleaseJsAndAssets_SentryUpload`. iOS builds on the runner and
// already used the GitHub secret. One source of truth: the GitHub secret.
//
// Only the target environment changes. If a project variable shares this
// environment with others, the target is split off into its own SECRET
// variable; the other environments keep their variable and value untouched.
//
// Env: EXPO_TOKEN, EAS_PROJECT_ID, EAS_ENVIRONMENT (preview|production),
//      SENTRY_AUTH_TOKEN (empty = skip with a warning, nothing changes).
// Never prints the token.
import { pathToFileURL } from 'node:url';

export const NAME = 'SENTRY_AUTH_TOKEN';
const API = 'https://api.expo.dev/graphql';

/**
 * Decide the minimal change for `target`, given the project-scope variables
 * named SENTRY_AUTH_TOKEN ({ id, environments }).
 * Returns { action: 'update', id } | { action: 'split', id, keep } | { action: 'create' }.
 */
export function plan(vars, target) {
  const same = (e) => String(e).toLowerCase() === target.toLowerCase();
  const hit = vars.find((v) => (v.environments ?? []).some(same));
  if (!hit) return { action: 'create' };
  const keep = hit.environments.filter((e) => !same(e));
  return keep.length === 0 ? { action: 'update', id: hit.id } : { action: 'split', id: hit.id, keep };
}

async function gql(token, query, variables) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.errors) {
    throw new Error(`Expo API HTTP ${res.status}: ${(body.errors ?? []).map((e) => e.message).join('; ')}`);
  }
  return body.data;
}

const LIST = `query($appId: String!, $names: [String!]) {
  app { byId(appId: $appId) { environmentVariables(filterNames: $names) { id name scope environments visibility } } }
}`;
const UPDATE = `mutation($input: UpdateEnvironmentVariableInput!) {
  environmentVariable { updateEnvironmentVariable(environmentVariableData: $input) { id environments } }
}`;
const CREATE = `mutation($input: CreateEnvironmentVariableInput!, $appId: ID!) {
  environmentVariable { createEnvironmentVariableForApp(environmentVariableData: $input, appId: $appId) { id environments } }
}`;

async function main() {
  const { EXPO_TOKEN: token, EAS_PROJECT_ID: appId, EAS_ENVIRONMENT: target, SENTRY_AUTH_TOKEN: value } = process.env;
  if (!token || !appId || !target) throw new Error('EXPO_TOKEN, EAS_PROJECT_ID and EAS_ENVIRONMENT are required');
  if (!value) {
    console.log(`::warning::SENTRY_AUTH_TOKEN is empty in this job; EAS ${target} keeps its current value`);
    return;
  }
  const data = await gql(token, LIST, { appId, names: [NAME] });
  const vars = (data.app.byId.environmentVariables ?? []).filter((v) => v.name === NAME && v.scope === 'PROJECT');
  const p = plan(vars, target);
  if (p.action === 'update') {
    await gql(token, UPDATE, { input: { id: p.id, value, visibility: 'SECRET', environments: [target] } });
  } else if (p.action === 'split') {
    await gql(token, UPDATE, { input: { id: p.id, environments: p.keep } });
    await gql(token, CREATE, { appId, input: { name: NAME, value, visibility: 'SECRET', environments: [target], type: 'STRING' } });
  } else {
    await gql(token, CREATE, { appId, input: { name: NAME, value, visibility: 'SECRET', environments: [target], type: 'STRING' } });
  }
  const detail = p.action === 'split' ? ` (split off from the variable shared with ${p.keep.join(', ')})` : '';
  console.log(`EAS ${target}: ${NAME} ${p.action === 'create' ? 'created' : 'updated'} from the mobile-store secret${detail}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => {
    console.log(`::error::sync-eas-sentry-token: ${e.message}`);
    process.exit(1);
  });
}
