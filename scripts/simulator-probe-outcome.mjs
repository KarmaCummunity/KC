#!/usr/bin/env node
// Parses the iPhone-simulator probe log and prints one deterministic outcome (#856).
//
// The app-side probe logs exactly one status line:
//   '[secure-storage-probe] ok' | '[secure-storage-probe] mismatch: …' | '[secure-storage-probe] fail: …'
// Decision (fail-closed):
//   'ok'        — exactly one or more ok lines and nothing else probe-related;
//   'failed'    — any fail/mismatch line, even if an ok line is also present (mixed input);
//   'ambiguous' — a marker line whose status is neither ok/fail/mismatch (malformed payload);
//   'missing'   — no probe marker line at all.
// Only 'ok' exits 0. Usage: node scripts/simulator-probe-outcome.mjs <log-file>

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MARKER = '[secure-storage-probe]';

export function probeOutcome(logText) {
  let ok = 0, bad = 0, malformed = 0;
  for (const line of String(logText).split('\n')) {
    const at = line.indexOf(MARKER);
    if (at === -1) continue;
    const status = line.slice(at + MARKER.length).trim();
    if (status === 'ok') ok += 1;
    else if (status.startsWith('fail:') || status.startsWith('mismatch:')) bad += 1;
    else malformed += 1;
  }
  if (bad > 0) return 'failed';
  if (malformed > 0) return 'ambiguous';
  if (ok > 0) return 'ok';
  return 'missing';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node scripts/simulator-probe-outcome.mjs <log-file>');
    process.exit(2);
  }
  const outcome = probeOutcome(readFileSync(file, 'utf8'));
  console.log(`secure-storage probe outcome: ${outcome}`);
  process.exit(outcome === 'ok' ? 0 : 1);
}
