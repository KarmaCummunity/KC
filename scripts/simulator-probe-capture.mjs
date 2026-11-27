#!/usr/bin/env node
// Bounded simulator log capture for the #856 secure-storage probe qualification.
//
// Runs `xcrun simctl spawn <udid> log show --style compact --start <utc> --predicate
// process == "KC"` with a hard timeout: the child gets SIGKILL after <cap-seconds> and
// whatever was captured up to then stays in the log file. Exiting 0 on a timeout is
// deliberate — scripts/simulator-probe-outcome.mjs decides ok/fail/missing/ambiguous from
// the file, and a killed capture simply yields 'missing' until the marker appears.
//
// The command is injectable (KC_PROBE_CAPTURE_CMD / KC_PROBE_CAPTURE_ARGS) so the behavior
// fixtures can run without a macOS simulator.
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';

export function parseArgs(argv, env = process.env) {
  const [logFile, udid, startUtc, capSeconds] = argv;
  if (!logFile || !udid || !startUtc || !capSeconds) return null;
  const cap = Number.parseInt(capSeconds, 10);
  if (!Number.isFinite(cap) || cap < 1) return null;
  const cmd = env.KC_PROBE_CAPTURE_CMD || 'xcrun';
  const args = env.KC_PROBE_CAPTURE_CMD
    ? JSON.parse(env.KC_PROBE_CAPTURE_ARGS || '[]')
    : ['simctl', 'spawn', udid, 'log', 'show', '--style', 'compact', '--start', startUtc,
      '--predicate', 'process == "KC"'];
  return { logFile, cmd, args, cap: Math.min(cap, 300) };
}

export function capture({ logFile, cmd, args, cap }) {
  return new Promise((resolve) => {
    const out = createWriteStream(logFile);
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(out);
    child.stderr.pipe(out);
    const kill = setTimeout(() => child.kill('SIGKILL'), cap * 1000);
    const done = (code) => { clearTimeout(kill); out.end(() => resolve(code ?? 0)); };
    child.on('error', () => done(0));
    child.on('close', (code) => done(code ?? 0));
  });
}

if (process.argv[1] && process.argv[1].endsWith('simulator-probe-capture.mjs')) {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed) {
    console.error('usage: node scripts/simulator-probe-capture.mjs <log-file> <udid> <start-utc> <cap-seconds>');
    process.exit(2);
  }
  process.exit(await capture(parsed));
}
