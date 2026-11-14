#!/usr/bin/env node
// Runs a Supabase CLI command and retries it ONLY when it failed before reaching the
// database (pooler connect timeout / refused / DNS). Any other failure is returned as is.
//
// Why: Deploy run 43502416446 and 43505342327 (13 Nov 2026) failed at
// `supabase db push --dry-run` / `supabase migration list` with
// "failed to connect to postgres ... pooler.supabase.com ... timeout: context deadline exceeded"
// while kc-dev was healthy; a plain re-run went green. A connect failure means no SQL ran,
// so retrying it is safe, including for `supabase db push`.
//
// Usage: node scripts/db-connect-retry.mjs [--attempts N] [--delay-ms MS] -- <cmd> [args...]
// Output is streamed (so `| tee` callers keep working) and the exit code is the command's.
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** Output of a CLI run that never reached the database (safe to retry). */
export const CONNECT_FAILURE = [
  /failed to connect to postgres/i,
  /failed to connect to `host=/i,
  /connect: connection refused/i,
  /no such host/i,
  /i\/o timeout/i,
];

/** True when the output shows the command failed before any SQL could run. */
export function isConnectFailure(output) {
  return CONNECT_FAILURE.some((re) => re.test(output));
}

export function parseArgs(argv) {
  const opts = { attempts: 3, delayMs: 20000, cmd: [] };
  const sep = argv.indexOf('--');
  if (sep === -1 || sep === argv.length - 1) throw new Error('usage: db-connect-retry.mjs [--attempts N] [--delay-ms MS] -- <cmd> [args...]');
  const flags = argv.slice(0, sep);
  for (let i = 0; i < flags.length; i += 1) {
    const value = Number(flags[i + 1]);
    if (flags[i] === '--attempts' && Number.isInteger(value) && value >= 1 && value <= 10) { opts.attempts = value; i += 1; }
    else if (flags[i] === '--delay-ms' && Number.isInteger(value) && value >= 0) { opts.delayMs = value; i += 1; }
    else throw new Error(`unknown or invalid flag: ${flags[i]}`);
  }
  opts.cmd = argv.slice(sep + 1);
  return opts;
}

function runOnce([cmd, ...args]) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['inherit', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (d) => { output += d; process.stdout.write(d); });
    child.stderr.on('data', (d) => { output += d; process.stderr.write(d); });
    child.on('error', (err) => resolve({ code: 127, output: String(err) }));
    child.on('close', (code) => resolve({ code: code ?? 1, output }));
  });
}

/** Runs with retries; `run` and `sleep` are injectable for tests. */
export async function runWithRetry(opts, { run = runOnce, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = console.log } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    const { code, output } = await run(opts.cmd);
    if (code === 0) return 0;
    if (!isConnectFailure(output) || attempt >= opts.attempts) return code;
    const wait = opts.delayMs * attempt;
    log(`::warning::database connect failed (attempt ${attempt}/${opts.attempts}); no SQL ran, retrying in ${Math.round(wait / 1000)}s`);
    await sleep(wait);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (err) { console.error(`::error::${err.message}`); process.exit(2); }
  process.exitCode = await runWithRetry(opts);
}
