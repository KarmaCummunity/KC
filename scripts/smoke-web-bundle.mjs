#!/usr/bin/env node
// Web bundle smoke test — boots the production export in headless Chromium
// and asserts the home page renders with zero runtime errors.
//
// Catches the class of bug that typecheck/test/lint can't see:
//   - Expo Router route-enumeration crashes (e.g. missing .tsx fallback for
//     a .web.tsx route)
//   - Top-level exceptions thrown during initial render
//   - Missing-module errors that only show up at runtime
//
// Usage: node scripts/smoke-web-bundle.mjs [--dist <path>] [--port N]
// Defaults: dist = app/apps/mobile/dist, port = 8765
//
// Exits 0 on success, non-zero on any pageerror or console.error (excluding
// known-noise env-var warnings).

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
}

const distDir = arg('--dist', join(REPO_ROOT, 'app/apps/mobile/dist'));
const port = parseInt(arg('--port', '8765'), 10);

if (!existsSync(distDir) || !existsSync(join(distDir, 'index.html'))) {
  console.error(`✗ Smoke test failed: missing bundle at ${distDir}/index.html`);
  console.error('  Run `pnpm --filter @kc/mobile build:web` first.');
  process.exit(2);
}

// Known runtime noise we don't fail on. CI runs without prod secrets — that's
// expected to surface a Supabase-config error, not a real bug.
const IGNORE_PATTERNS = [
  /Supabase configuration missing/i,
  /EXPO_PUBLIC_SUPABASE_URL/i,
  /EXPO_PUBLIC_SUPABASE_ANON_KEY/i,
  // CI builds with a placeholder anon key against a real project URL, so the welcome screen's
  // public `app_flags` read (launch-surface overrides) answers 401. Only that exact browser
  // message is ignored; other statuses (404/500) and every JS error still fail the smoke.
  /Failed to load resource: the server responded with a status of 401\b/i,
];

function isNoise(text) {
  return IGNORE_PATTERNS.some((re) => re.test(text));
}

// Start static server. Use python3's http.server — universally available on
// macOS + Ubuntu CI runners, no extra install.
const server = spawn('python3', ['-m', 'http.server', String(port), '--directory', distDir], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

let exitCode = 0;
async function cleanup() {
  server.kill();
  await new Promise((r) => setTimeout(r, 100));
}
process.on('SIGINT', async () => { await cleanup(); process.exit(130); });

try {
  // Give server a moment to start.
  await new Promise((r) => setTimeout(r, 1500));

  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const errors = [];
  page.on('pageerror', (e) => {
    if (!isNoise(e.message)) errors.push(`pageerror: ${e.message}`);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !isNoise(msg.text())) {
      errors.push(`console.error: ${msg.text()}`);
    }
  });

  console.log(`→ loading http://localhost:${port}/ in headless Chromium…`);
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  await browser.close();

  if (errors.length > 0) {
    console.error('✗ Web bundle smoke test FAILED — page emitted runtime errors:');
    for (const e of errors) console.error(`  • ${e}`);
    exitCode = 1;
  } else {
    console.log('✓ Web bundle smoke test passed — zero runtime errors on initial render');
  }
} catch (err) {
  console.error(`✗ Smoke test crashed: ${err.message}`);
  exitCode = 3;
} finally {
  await cleanup();
}

process.exit(exitCode);
