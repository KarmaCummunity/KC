import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { instrumentStartup } from './ipad-qualification-startup.mjs';

test('diagnostic markers preserve startup decisions and contain no user values', () => {
  const source = readFileSync(new URL('../app/apps/mobile/app/_layout.tsx', import.meta.url), 'utf8');
  const result = instrumentStartup(source);
  assert.match(result, /rtl-read-start/);
  assert.match(result, /rtl-read-finished/);
  assert.match(result, /rtl-needs-reload/);
  assert.match(result, /rtl-reload-call/);
  assert.match(result, /if \(needsReload\).*reloadApp\(\)/);
  assert.match(result, /applyLayoutDirection\(desired\)/);
  assert.doesNotMatch(result, /console.warn\([^\n]*(stored|desired|userId|token)/);
  assert.throws(() => instrumentStartup(result), /anchor/);
  assert.throws(() => instrumentStartup(''), /anchor/);
});

test('startup instrumentation is isolated to non-main DEV diagnostic workflow', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ipad-guest-qualification.yml', import.meta.url), 'utf8');
  assert.match(workflow, /node scripts\/ipad-qualification-startup.mjs/);
  assert.match(workflow, /github.ref != 'refs\/heads\/main'/);
  assert.match(workflow, /diagnostic-source.txt/);
  for (const path of ['testflight-ios.yml', 'prod-store-build.yml', 'mobile-nightly.yml']) {
    assert.doesNotMatch(readFileSync(new URL(`../.github/workflows/${path}`, import.meta.url), 'utf8'), /ipad-qualification-startup/);
  }
});
