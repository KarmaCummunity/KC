#!/usr/bin/env node
/** #901 — coarse bundle budget after `expo export --platform web` (gzip KB). */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST = join(import.meta.dirname, '../apps/mobile/dist');
const BUDGET_KB = Number(process.env.KC_MOBILE_WEB_BUNDLE_BUDGET_KB ?? '4200');

function gzipSize(path) {
  return gzipSync(readFileSync(path)).length;
}

function mainBundlePath() {
  if (!existsSync(DIST)) return null;
  // Expo export: largest JS under dist/_expo/static/js/web/*.js
  const webJsDir = join(DIST, '_expo/static/js/web');
  if (!existsSync(webJsDir)) return null;
  let best = null;
  let bestSize = 0;
  for (const name of readdirSync(webJsDir)) {
    if (!name.endsWith('.js')) continue;
    const p = join(webJsDir, name);
    const sz = gzipSize(p);
    if (sz > bestSize) {
      bestSize = sz;
      best = p;
    }
  }
  return best ? { path: best, gzipKb: Math.round(bestSize / 1024) } : null;
}

const main = mainBundlePath();
// A missing bundle means the export did not run or changed layout; passing
// silently would disable the budget, so treat it as a failure.
if (!main) {
  console.error(`check-mobile-bundle-budget: no web bundle under ${DIST}/_expo/static/js/web — run \`pnpm build:web\` first`);
  process.exit(1);
}

console.log(`check-mobile-bundle-budget: main ${main.path} gzip ${main.gzipKb}KB (budget ${BUDGET_KB}KB)`);
if (main.gzipKb > BUDGET_KB) process.exit(1);
