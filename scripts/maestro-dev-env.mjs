#!/usr/bin/env node
// KC#1235 — resolves the environment for the Maestro Android E2E build against kc-dev,
// with one repository secret (E2E_SEED_PASSWORD):
//   EXPO_PUBLIC_SUPABASE_URL       kc-dev project URL (public)
//   EXPO_PUBLIC_SUPABASE_ANON_KEY  publishable key, read from the deployed dev web bundle (public)
//   KC_E2E_PASSWORD                kc-dev seed users' password, from the E2E_SEED_PASSWORD env (secret)
// Prints `KEY=value` lines (append them to $GITHUB_ENV). Refuses to target production.
//
// Usage: node scripts/maestro-dev-env.mjs [--web-url https://dev.karma-community.pages.dev]

import { fileURLToPath } from 'node:url';

export const KC_DEV_SUPABASE_URL = 'https://enbqriuxvvuontiwslun.supabase.co';
export const DEFAULT_DEV_WEB_URL = 'https://dev.karma-community.pages.dev';

const PROD_SUPABASE_REF = 'kdqtbdbzwvlugkhonexg';
const PROD_WEB_HOST = 'karma-community-kc.com';
// Every Supabase legacy JWT starts with this base64url header ({"alg":"HS256","typ":"JWT"}).
const JWT_PATTERN = /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const PUBLISHABLE_PATTERN = /sb_publishable_[A-Za-z0-9_-]+/;

/** Throws when either target points at production. */
export function assertNotProduction(supabaseUrl, webUrl) {
  if (supabaseUrl.includes(PROD_SUPABASE_REF) || new URL(webUrl).hostname.endsWith(PROD_WEB_HOST)) {
    throw new Error('Maestro E2E refuses to run against production.');
  }
}

/** The anon key for `ref` in a JS bundle: a legacy anon JWT for that project, else a publishable key. */
export function extractAnonKey(js, ref) {
  for (const [token] of js.matchAll(JWT_PATTERN)) {
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
      if (payload.role === 'anon' && payload.ref === ref) return token;
    } catch {
      // Not a JSON payload; keep scanning.
    }
  }
  return js.match(PUBLISHABLE_PATTERN)?.[0] ?? null;
}

/** The seed users' password from the E2E_SEED_PASSWORD env (GitHub Actions secret). Throws when unset. */
export function seedPasswordFromEnv(env = process.env) {
  const value = env.E2E_SEED_PASSWORD?.trim();
  if (!value) throw new Error('E2E_SEED_PASSWORD is not set (seed password secret); refusing to continue.');
  return value;
}

/** Script URLs of the Expo web export referenced by the dev site's index.html. */
export function bundleUrls(html, webUrl) {
  return [...html.matchAll(/\/_expo\/static\/js\/web\/[^"']+\.js/g)].map(([path]) => new URL(path, webUrl).href);
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.text();
}

async function resolveAnonKey(webUrl) {
  const ref = new URL(KC_DEV_SUPABASE_URL).hostname.split('.')[0];
  for (const url of bundleUrls(await fetchText(webUrl), webUrl)) {
    const key = extractAnonKey(await fetchText(url), ref);
    if (key) return key;
  }
  throw new Error(`No kc-dev anon key found in the bundles of ${webUrl}`);
}

async function main() {
  const flag = process.argv.indexOf('--web-url');
  const webUrl = (flag > -1 ? process.argv[flag + 1] : process.env.DEV_WEB_URL) || DEFAULT_DEV_WEB_URL;
  assertNotProduction(KC_DEV_SUPABASE_URL, webUrl);

  const lines = [
    `EXPO_PUBLIC_SUPABASE_URL=${KC_DEV_SUPABASE_URL}`,
    `EXPO_PUBLIC_SUPABASE_ANON_KEY=${await resolveAnonKey(webUrl)}`,
    `KC_E2E_PASSWORD=${seedPasswordFromEnv()}`,
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
