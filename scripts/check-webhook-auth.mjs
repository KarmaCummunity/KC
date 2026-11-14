#!/usr/bin/env node
// Every Edge Function that runs without a Supabase JWT (`verify_jwt = false` in
// supabase/config.toml) is called by an outside provider, so the function itself
// must authenticate the caller and fail closed when its secret is missing.
//
// This guard fails when:
//   - a `verify_jwt = false` function is not registered in WEBHOOK_AUTH below
//     (a new webhook must say how it authenticates its caller);
//   - a registered function's source no longer carries the markers of that check;
//   - any function reads an environment switch that skips the check.
//
// Run by the static-guards lane on every change and by the Edge Functions deploy
// job on the exact commit it deploys, so a tree without these checks never ships.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// `--root <dir>` checks another checkout (the deploy job runs its own copy of this
// guard against the commit it deploys).
const rootArg = process.argv.indexOf('--root');
const REPO_ROOT = rootArg > 0 && process.argv[rootArg + 1]
  ? resolve(process.argv[rootArg + 1])
  : resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Function name → patterns its non-test source must all contain. */
export const WEBHOOK_AUTH = {
  'payments-webhook': [/x-kc-signature/, /crypto\.subtle\.importKey\([\s\S]{0,200}?HMAC/, /timingSafeEqual\(/],
  'whatsapp-webhook': [/x-hub-signature-256/, /hmacSha256Hex\(/, /timingSafeEqual\(/],
  'revenuecat-webhook': [/REVENUECAT_WEBHOOK_AUTH/, /safeEqual\(/],
};

/** An environment switch that turns caller authentication off. */
const BYPASS_SWITCH = /Deno\.env\.get\(\s*['"][A-Z0-9_]*(SKIP|DISABLE|BYPASS)[A-Z0-9_]*(SIGNATURE|VERIFY|AUTH)[A-Z0-9_]*['"]/;

/** Names of the `[functions.<name>]` blocks with `verify_jwt = false`. */
export function publicFunctions(configToml) {
  const names = [];
  let current = null;
  for (const raw of configToml.split('\n')) {
    const line = raw.trim();
    const header = /^\[functions\.([\w-]+)\]$/.exec(line);
    if (header) current = header[1];
    else if (line.startsWith('[')) current = null;
    else if (current && /^verify_jwt\s*=\s*false\b/.test(line)) names.push(current);
  }
  return names;
}

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|js|mjs)$/.test(entry) && !/\.test\.(ts|js|mjs)$/.test(entry)) out.push(path);
  }
  return out;
}

/**
 * @param {{ configToml: string, readFunction: (name: string) => string | null, allSources: { path: string, text: string }[] }} input
 * @returns {string[]} problems
 */
export function checkWebhookAuth({ configToml, readFunction, allSources }) {
  const problems = [];
  for (const name of publicFunctions(configToml)) {
    const patterns = WEBHOOK_AUTH[name];
    if (!patterns) {
      problems.push(`${name}: verify_jwt = false but not registered in scripts/check-webhook-auth.mjs`);
      continue;
    }
    const text = readFunction(name);
    if (text === null) {
      problems.push(`${name}: listed in supabase/config.toml but supabase/functions/${name} is missing`);
      continue;
    }
    for (const re of patterns) if (!re.test(text)) problems.push(`${name}: caller check marker ${re} not found`);
  }
  for (const { path, text } of allSources) {
    if (BYPASS_SWITCH.test(text)) problems.push(`${path}: reads an environment switch that skips caller authentication`);
  }
  return problems;
}

function main() {
  const functionsDir = join(REPO_ROOT, 'supabase', 'functions');
  const configToml = readFileSync(join(REPO_ROOT, 'supabase', 'config.toml'), 'utf8');
  const readFunction = (name) => {
    const dir = join(functionsDir, name);
    if (!existsSync(dir)) return null;
    return sourceFiles(dir).map((p) => readFileSync(p, 'utf8')).join('\n');
  };
  const allSources = sourceFiles(functionsDir).map((p) => ({
    path: p.slice(REPO_ROOT.length + 1),
    text: readFileSync(p, 'utf8'),
  }));
  const problems = checkWebhookAuth({ configToml, readFunction, allSources });
  if (problems.length) {
    for (const p of problems) console.error(`::error::${p}`);
    process.exit(1);
  }
  console.log(`webhook caller checks present for: ${publicFunctions(configToml).join(', ')}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
