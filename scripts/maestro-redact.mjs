#!/usr/bin/env node
// Replaces the kc-dev seed password in the Maestro output before it is uploaded as an artifact.
//
// Maestro records every `-e` variable in plain text: `commands.json` holds the whole env of each
// flow and `maestro.log` repeats it. The `maestro-android` artifact is readable by everyone with
// access to the repository, and GitHub's log masking does not reach files, so without this the
// password of the shared kc-dev seed users would be published with every run's debug output.
//
// Usage: KC_E2E_PASSWORD=... node scripts/maestro-redact.mjs <dir>
// Prints how many files were rewritten. Videos and screenshots are binary and left alone.

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REDACTED = '***';
const BINARY_EXTENSIONS = /\.(mp4|png|jpe?g|zip)$/i;

/** `text` with every occurrence of `secret` replaced. An empty secret would match everywhere, so it throws. */
export function redactSecret(text, secret) {
  if (!secret) throw new Error('refusing to redact an empty secret');
  return text.replaceAll(secret, REDACTED);
}

/** Rewrites every text file under `dir` that contains `secret`; returns the paths it changed. */
export function redactDirectory(dir, secret) {
  const changed = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      changed.push(...redactDirectory(path, secret));
    } else if (!BINARY_EXTENSIONS.test(name)) {
      const text = readFileSync(path, 'utf8');
      if (text.includes(secret)) {
        writeFileSync(path, redactSecret(text, secret));
        changed.push(path);
      }
    }
  }
  return changed;
}

function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error('usage: maestro-redact.mjs <dir>');
  const changed = redactDirectory(dir, process.env.KC_E2E_PASSWORD ?? '');
  console.log(`Redacted the seed password in ${changed.length} file(s).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
