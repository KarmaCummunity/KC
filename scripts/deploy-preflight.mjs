#!/usr/bin/env node
// Deploy preflight: fail closed before anything is deployed when a GitHub
// Environment is missing a secret or points at the wrong project.
//
// Run once per environment the deploy uses (secrets are per environment, and
// a job can read only one): `supabase <dev|prod>` inside supabase-dev/-prod,
// `web <dev|prod>` inside cloudflare-dev/-prod. The expected project refs are
// pinned here, so a dev secret that points at prod (or the reverse) stops the
// deploy instead of migrating the wrong database. Values are never printed.
//
// `supabase` env: SUPABASE_ACCESS_TOKEN, SUPABASE_DB_PASSWORD,
//   SUPABASE_PROJECT_REF, and on prod BACKUP_AGE_RECIPIENT (the pre-migration
//   backup is encrypted to it). The project must also be ACTIVE_HEALTHY.
// `web` env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID,
//   EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY,
//   EXPO_PUBLIC_ENVIRONMENT, WEB_URL.

import { fileURLToPath } from 'node:url';

export const TARGETS = {
  dev: { ref: 'enbqriuxvvuontiwslun', environment: 'development' },
  prod: { ref: 'kdqtbdbzwvlugkhonexg', environment: 'production' },
};

// age X25519 recipient: "age1" + 58 bech32 characters.
const AGE_RECIPIENT = /^age1[02-9ac-hj-np-z]{58}$/;

/** Reasons the Supabase secrets of `target` are unusable (empty = ok). */
export function checkSupabaseEnv(target, env) {
  const { ref } = TARGETS[target];
  const errors = [];
  if (!env.SUPABASE_ACCESS_TOKEN?.startsWith('sbp_')) {
    errors.push('SUPABASE_ACCESS_TOKEN must be a Supabase account token (sbp_…), not a project API key');
  }
  if (!env.SUPABASE_DB_PASSWORD) errors.push('SUPABASE_DB_PASSWORD is empty');
  if (env.SUPABASE_PROJECT_REF !== ref) {
    errors.push(`SUPABASE_PROJECT_REF must be the ${target} project ${ref} (got ${env.SUPABASE_PROJECT_REF ? 'another value' : 'nothing'})`);
  }
  if (target === 'prod' && !AGE_RECIPIENT.test(env.BACKUP_AGE_RECIPIENT ?? '')) {
    errors.push('BACKUP_AGE_RECIPIENT must be an age public key (age1…); the pre-migration backup cannot be encrypted without it');
  }
  return errors;
}

/** Reasons the web (Cloudflare Pages + build) settings of `target` are unusable. */
export function checkWebEnv(target, env) {
  const { ref, environment } = TARGETS[target];
  const errors = [];
  if (!env.CLOUDFLARE_API_TOKEN) errors.push('CLOUDFLARE_API_TOKEN is empty');
  if (!/^[0-9a-f]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID ?? '')) errors.push('CLOUDFLARE_ACCOUNT_ID must be a 32-hex Cloudflare account id');
  if (env.EXPO_PUBLIC_SUPABASE_URL !== `https://${ref}.supabase.co`) {
    errors.push(`EXPO_PUBLIC_SUPABASE_URL must be https://${ref}.supabase.co for ${target}`);
  }
  if (!env.EXPO_PUBLIC_SUPABASE_ANON_KEY) errors.push('EXPO_PUBLIC_SUPABASE_ANON_KEY is empty');
  if (env.EXPO_PUBLIC_ENVIRONMENT !== environment) errors.push(`EXPO_PUBLIC_ENVIRONMENT must be "${environment}" for ${target}`);
  if (!/^https:\/\/[^/\s]+\/?$/.test(env.WEB_URL ?? '')) {
    errors.push(`the ${target} web URL variable (${target === 'prod' ? 'KC_PROD_URL' : 'DEV_WEB_URL'}) must be an https origin`);
  }
  return errors;
}

/** Supabase Management API status of the project; anything but ACTIVE_HEALTHY fails. */
export async function checkProjectActive({ ref, token, fetch }) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return [`Supabase Management API → HTTP ${res.status} for project ${ref} (token cannot see it?)`];
  const { status } = await res.json();
  return status === 'ACTIVE_HEALTHY' ? [] : [`Supabase project ${ref} is ${status}; restore it before deploying`];
}

async function main([kind, target]) {
  if (!['supabase', 'web'].includes(kind) || !TARGETS[target]) {
    console.error('usage: deploy-preflight.mjs <supabase|web> <dev|prod>');
    process.exit(2);
  }
  const env = process.env;
  const errors = kind === 'web' ? checkWebEnv(target, env) : checkSupabaseEnv(target, env);
  if (kind === 'supabase' && errors.length === 0) {
    errors.push(...(await checkProjectActive({ ref: TARGETS[target].ref, token: env.SUPABASE_ACCESS_TOKEN, fetch: globalThis.fetch })));
  }
  for (const e of errors) console.log(`::error title=${kind} preflight (${target})::${e}`);
  if (errors.length) process.exit(1);
  console.log(`${kind} preflight passed for ${target}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.log(`::error::${err.message}`);
    process.exit(1);
  });
}
