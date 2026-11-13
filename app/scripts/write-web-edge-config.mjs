#!/usr/bin/env node
// Writes the deploy-time configuration of the Cloudflare Pages shared-link function
// (app/apps/mobile/web-edge/src/generatedConfig.mjs). The function runs on the Workers runtime,
// which has no access to the build environment, so the values it needs are baked in here from the
// same public variables the web bundle is built with.
//
// Everything written is public: the Supabase URL and anon key ship inside the web bundle, and the
// store URLs are links. No secret may pass through this file.

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Maps a key of the generated config to the environment variable it is read from. */
const SOURCES = {
  SUPABASE_URL: 'EXPO_PUBLIC_SUPABASE_URL',
  SUPABASE_ANON_KEY: 'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  APP_BASE_URL: 'EXPO_PUBLIC_WEB_BASE_URL',
  KC_IOS_STORE_URL: 'KC_IOS_STORE_URL',
  KC_ANDROID_STORE_URL: 'KC_ANDROID_STORE_URL',
};

/** Keys that must be present for the card of a post to be readable; the rest are optional. */
const REQUIRED = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];

/** @returns the config object for `env`; throws when a required value is missing. */
export function buildEdgeConfig(env) {
  const config = {};
  for (const [key, variable] of Object.entries(SOURCES)) {
    const value = (env[variable] ?? '').trim();
    if (value) config[key] = value;
  }
  const missing = REQUIRED.filter((key) => !config[key]);
  if (missing.length > 0) {
    throw new Error(`write-web-edge-config: missing ${missing.map((k) => SOURCES[k]).join(', ')}`);
  }
  return config;
}

/** Renders the module the function imports. JSON keeps every value a plain string literal. */
export function renderEdgeConfigModule(config) {
  return (
    '// Generated at deploy time by app/scripts/write-web-edge-config.mjs. Do not edit or commit.\n' +
    `export const BUILD_CONFIG = ${JSON.stringify(config, null, 2)};\n`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'mobile', 'web-edge', 'src', 'generatedConfig.mjs');
  writeFileSync(target, renderEdgeConfigModule(buildEdgeConfig(process.env)), 'utf8');
  console.log(`[write-web-edge-config] wrote ${target}`);
}
