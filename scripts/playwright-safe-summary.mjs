#!/usr/bin/env node
// Public CI artifacts must not include browser DOM, credentials, tokens, network bodies,
// traces, videos, or failure attachments. Export numeric counts only from the local report.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function safeSummary(report) {
  const stats = report?.stats;
  if (!stats || typeof stats !== 'object') throw new Error('Missing Playwright statistics');
  const output = { format: 'kc-playwright-counts-v1' };
  for (const key of ['expected', 'unexpected', 'flaky', 'skipped', 'duration']) {
    if (typeof stats[key] !== 'number' || !Number.isFinite(stats[key]) || stats[key] < 0) {
      throw new Error('Invalid Playwright statistics');
    }
    output[key] = stats[key];
  }
  return output;
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output || resolve(input) === resolve(output)) throw new Error('Distinct input and output paths required');
  const summary = safeSummary(JSON.parse(readFileSync(input, 'utf8')));
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(summary, null, 2) + '\n');
}
