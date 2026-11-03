#!/usr/bin/env node
// The one place store builds (testflight-ios.yml, play-internal.yml) get their
// Supabase backend from (D-195 "Mobile nightly").
//
// Tester builds come from `dev` and always use the kc-dev project. Production
// store builds from `main` (prod backend) are not wired yet, so any other
// source branch fails closed instead of silently shipping a dev-backed build
// from main or a prod-backed build to testers.
//
//   pin    Write the kc-dev URL and MOBILE_SUPABASE_ANON_KEY (from the
//          `mobile-store` GitHub Environment) into the eas.json `nightly`
//          profile `env`, on the runner only. eas-cli resolves a profile's
//          `env` over the EAS server environment; the build is still checked
//          by `verify`, because a cloud builder also receives server variables.
//   verify <bundle>
//          Fail unless the JS bundle extracted from the built IPA / AAB
//          contains the kc-dev project URL and no prod project URL. Hermes
//          bytecode stores string literals verbatim, so a byte search works.
//
// Inputs (env): SOURCE_BRANCH, MOBILE_SUPABASE_ANON_KEY (pin);
// EAS_JSON (default app/apps/mobile/eas.json), EAS_PROFILE (default nightly).

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Supabase project refs, as listed in docs/SSOT/ENVIRONMENTS.md. */
export const DEV_REF = 'enbqriuxvvuontiwslun';
export const PROD_REF = 'kdqtbdbzwvlugkhonexg';
export const DEV_URL = `https://${DEV_REF}.supabase.co`;

/** Decode a JWT payload, or return null when the key is not a JWT. */
function jwtPayload(key) {
  const parts = key.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Check that the key is a client-safe key of project `ref`. Legacy anon keys
 * are JWTs carrying `ref` and `role`; new `sb_publishable_` keys carry neither,
 * so only their prefix can be checked (`verify` still checks the built URL).
 */
export function checkAnonKey(key, ref) {
  if (!key) return ['MOBILE_SUPABASE_ANON_KEY is not set'];
  if (key.startsWith('sb_publishable_')) return [];
  if (key.startsWith('sb_secret_')) return ['MOBILE_SUPABASE_ANON_KEY is a secret key; use the publishable (anon) key'];
  const payload = jwtPayload(key);
  if (!payload) return ['MOBILE_SUPABASE_ANON_KEY is neither an sb_publishable_ key nor a Supabase JWT'];
  const errors = [];
  if (payload.role !== 'anon') errors.push(`MOBILE_SUPABASE_ANON_KEY has role "${payload.role}"; use the anon key`);
  if (payload.ref !== ref) errors.push(`MOBILE_SUPABASE_ANON_KEY belongs to project "${payload.ref}", not "${ref}"`);
  return errors;
}

/** Errors that block pinning the dev backend for a build from `branch`. */
export function checkPin({ branch, anonKey }) {
  if (branch !== 'dev') {
    return [`store builds use the kc-dev backend and must come from dev (got "${branch ?? ''}"); prod store builds from main are not wired yet`];
  }
  return checkAnonKey(anonKey, DEV_REF);
}

/** Errors when a built JS bundle does not point at kc-dev only. */
export function checkBundle(bundle) {
  const text = bundle.toString('latin1');
  const errors = [];
  if (!text.includes(DEV_URL)) errors.push(`bundle does not contain the kc-dev URL ${DEV_URL}`);
  if (text.includes(PROD_REF)) errors.push(`bundle contains the prod project ref ${PROD_REF}`);
  return errors;
}

/** Return a copy of eas.json with `vars` merged into build.<profile>.env. */
export function injectProfileEnv(easJson, profile, vars) {
  const build = easJson.build?.[profile];
  if (!build) throw new Error(`eas.json has no build profile "${profile}"`);
  return {
    ...easJson,
    build: { ...easJson.build, [profile]: { ...build, env: { ...build.env, ...vars } } },
  };
}

function fail(errors) {
  for (const e of errors) console.log(`::error::${e}`);
  process.exit(1);
}

function pin(env) {
  const anonKey = env.MOBILE_SUPABASE_ANON_KEY?.trim() ?? '';
  const errors = checkPin({ branch: env.SOURCE_BRANCH, anonKey });
  if (errors.length) fail(errors);
  const easPath = env.EAS_JSON || 'app/apps/mobile/eas.json';
  const profile = env.EAS_PROFILE || 'nightly';
  const easJson = JSON.parse(readFileSync(easPath, 'utf8'));
  const next = injectProfileEnv(easJson, profile, {
    EXPO_PUBLIC_SUPABASE_URL: DEV_URL,
    EXPO_PUBLIC_SUPABASE_ANON_KEY: anonKey,
  });
  writeFileSync(easPath, `${JSON.stringify(next, null, 2)}\n`);
  const line = `Store build backend: Supabase **kc-dev** (\`${DEV_REF}\`), eas.json profile "${profile}".`;
  console.log(line);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${line}\n`);
}

function verify(bundlePath) {
  if (!bundlePath) fail(['usage: mobile-store-config.mjs verify <bundle>']);
  const errors = checkBundle(readFileSync(bundlePath));
  if (errors.length) fail(errors);
  console.log(`${bundlePath}: points at kc-dev only.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, arg] = process.argv.slice(2);
  if (mode === 'pin') pin(process.env);
  else if (mode === 'verify') verify(arg);
  else fail([`unknown mode "${mode ?? ''}"; use pin or verify <bundle>`]);
}
