#!/usr/bin/env node
// The one place store builds (testflight-ios.yml, play-internal.yml) get their
// Supabase backend from (D-195 "Mobile nightly").
//
// Tester builds come from `dev` and always use the kc-dev project. Production
// store builds come from `main` and always use the kc-prod project, selected
// by STORE_BACKEND=prod (prod-store-build.yml). The default (unset or any
// other value) stays the existing dev path and still refuses a non-dev branch.
//
//   pin    Write the selected backend URL and MOBILE_SUPABASE_ANON_KEY (from
//          the `mobile-store` GitHub Environment) into the eas.json profile
//          `env` (`nightly` for dev, `production` for prod, overridable with
//          EAS_PROFILE), on the runner only. eas-cli resolves a profile's
//          `env` over the EAS server environment; the build is still checked
//          by `verify`, because a cloud builder also receives server variables.
//   verify <bundle>
//          Fail unless the JS bundle extracted from the built IPA / AAB
//          contains the selected backend and not the other project's ref.
//          Hermes bytecode stores string literals verbatim, so a byte search works.
//
// `pin` also writes the non-secret Sentry settings (EXPO_PUBLIC_SENTRY_DSN, SENTRY_ORG,
// SENTRY_PROJECT, SENTRY_URL, from the `mobile-store` environment variables) into the same
// profile env, so iOS and Android builds read Sentry from one place. SENTRY_AUTH_TOKEN
// stays a secret (runner env for iOS, EAS server environment for Android).
//
// Inputs (env): SOURCE_BRANCH, MOBILE_SUPABASE_ANON_KEY, optional Sentry vars (pin);
// STORE_BACKEND (prod or default dev), EAS_JSON (default app/apps/mobile/eas.json),
// EAS_PROFILE (default nightly for dev, production for prod).

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Supabase project refs, as listed in docs/SSOT/ENVIRONMENTS.md. */
export const DEV_REF = 'enbqriuxvvuontiwslun';
export const PROD_REF = 'kdqtbdbzwvlugkhonexg';
export const DEV_URL = `https://${DEV_REF}.supabase.co`;
export const PROD_URL = `https://${PROD_REF}.supabase.co`;

/** `prod` only when STORE_BACKEND is exactly "prod"; anything else is the dev path. */
export function resolveStoreBackend(raw) {
  return String(raw ?? '').trim() === 'prod' ? 'prod' : 'dev';
}

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
  if (key.startsWith('sb_publishable_')) {
    const other = ref === DEV_REF ? PROD_REF : DEV_REF;
    if (key.includes(other)) {
      return [
        `MOBILE_SUPABASE_ANON_KEY is an sb_publishable_ key that embeds ${other}, not ${ref}`,
      ];
    }
    return [];
  }
  if (key.startsWith('sb_secret_')) return ['MOBILE_SUPABASE_ANON_KEY is a secret key; use the publishable (anon) key'];
  const payload = jwtPayload(key);
  if (!payload) return ['MOBILE_SUPABASE_ANON_KEY is neither an sb_publishable_ key nor a Supabase JWT'];
  const errors = [];
  if (payload.role !== 'anon') errors.push(`MOBILE_SUPABASE_ANON_KEY has role "${payload.role}"; use the anon key`);
  if (payload.ref !== ref) errors.push(`MOBILE_SUPABASE_ANON_KEY belongs to project "${payload.ref}", not "${ref}"`);
  return errors;
}

/** Errors that block pinning the selected backend for a build from `branch`. */
export function checkPin({ branch, anonKey, mode = 'dev' }) {
  const backend = resolveStoreBackend(mode);
  if (backend === 'prod') {
    if (branch !== 'main') {
      return [`PROD store builds use the kc-prod backend and must come from main (got "${branch ?? ''}")`];
    }
    return checkAnonKey(anonKey, PROD_REF);
  }
  if (branch !== 'dev') {
    return [`store builds use the kc-dev backend and must come from dev (got "${branch ?? ''}"); prod store builds from main go through prod-store-build.yml`];
  }
  return checkAnonKey(anonKey, DEV_REF);
}

/** Errors when a built JS bundle does not point at the selected backend only. */
export function checkBundle(bundle, mode = 'dev') {
  const text = bundle.toString('latin1');
  const errors = [];
  const backend = resolveStoreBackend(mode);
  if (backend === 'prod') {
    if (!text.includes(PROD_URL) && !text.includes(PROD_REF)) {
      errors.push(`bundle does not contain the kc-prod URL ${PROD_URL}`);
    }
    if (text.includes(DEV_REF)) {
      errors.push(`bundle contains the kc-dev project ref ${DEV_REF}`);
    }
    return errors;
  }
  if (!text.includes(DEV_URL)) errors.push(`bundle does not contain the kc-dev URL ${DEV_URL}`);
  if (text.includes(PROD_REF)) errors.push(`bundle contains the prod project ref ${PROD_REF}`);
  return errors;
}

/** Non-secret Sentry settings pinned into the build profile, so iOS (local build) and Android (cloud build) share one source. */
export const SENTRY_PIN_KEYS = ['EXPO_PUBLIC_SENTRY_DSN', 'SENTRY_ORG', 'SENTRY_PROJECT', 'SENTRY_URL'];

/** The Sentry settings set in `env` (trimmed, empty ones dropped). SENTRY_AUTH_TOKEN is a secret and is never pinned. */
export function sentryVars(env) {
  const out = {};
  for (const k of SENTRY_PIN_KEYS) {
    const v = env[k]?.trim();
    if (v) out[k] = v;
  }
  return out;
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
  const backend = resolveStoreBackend(env.STORE_BACKEND);
  const errors = checkPin({ branch: env.SOURCE_BRANCH, anonKey, mode: backend });
  if (errors.length) fail(errors);
  const easPath = env.EAS_JSON || 'app/apps/mobile/eas.json';
  const profile = env.EAS_PROFILE || (backend === 'prod' ? 'production' : 'nightly');
  const supabaseUrl = backend === 'prod' ? PROD_URL : DEV_URL;
  const ref = backend === 'prod' ? PROD_REF : DEV_REF;
  const easJson = JSON.parse(readFileSync(easPath, 'utf8'));
  const next = injectProfileEnv(easJson, profile, {
    EXPO_PUBLIC_SUPABASE_URL: supabaseUrl,
    EXPO_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    ...sentryVars(env),
  });
  writeFileSync(easPath, `${JSON.stringify(next, null, 2)}\n`);
  const label = backend === 'prod' ? 'kc-prod' : 'kc-dev';
  const line = `Store build backend: Supabase **${label}** (\`${ref}\`), eas.json profile "${profile}".`;
  console.log(line);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${line}\n`);
}

function verify(bundlePath, env = process.env) {
  if (!bundlePath) fail(['usage: mobile-store-config.mjs verify <bundle>']);
  const backend = resolveStoreBackend(env.STORE_BACKEND);
  const errors = checkBundle(readFileSync(bundlePath), backend);
  if (errors.length) fail(errors);
  const label = backend === 'prod' ? 'kc-prod' : 'kc-dev';
  console.log(`${bundlePath}: points at ${label} only.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, arg] = process.argv.slice(2);
  if (mode === 'pin') pin(process.env);
  else if (mode === 'verify') verify(arg, process.env);
  else fail([`unknown mode "${mode ?? ''}"; use pin or verify <bundle>`]);
}
