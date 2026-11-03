#!/usr/bin/env node
/** #896 — fail CI if react-native FlatList is imported in mobile app code. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../apps/mobile');
const SKIP = new Set(['node_modules', '.expo', 'web-server']);
// The KcFlashList wrapper is the one sanctioned place: it falls back to
// FlatList on native under the New Architecture (FlashList v1 grid overlap).
const ALLOW = new Set(['src/components/lists/KcFlashList.tsx']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(name)) out.push(p);
  }
  return out;
}

const offenders = [];
for (const file of walk(ROOT)) {
  if (ALLOW.has(file.replace(`${ROOT}/`, ''))) continue;
  const text = readFileSync(file, 'utf8');
  if (/import\s*\{[^}]*\bFlatList\b[^}]*\}\s*from\s*['"]react-native['"]/.test(text)) {
    offenders.push(file.replace(`${ROOT}/`, ''));
  }
}

if (offenders.length) {
  console.error('FlatList still imported from react-native in mobile app:');
  for (const f of offenders) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('check-mobile-flatlist: ok');
