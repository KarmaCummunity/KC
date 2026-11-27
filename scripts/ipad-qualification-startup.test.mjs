import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { instrumentStartup, instrumentLanguageBootstrap } from './ipad-qualification-startup.mjs';

test('diagnostic markers preserve startup decisions and contain no user values', () => {
  const source = readFileSync(new URL('../app/apps/mobile/app/_layout.tsx', import.meta.url), 'utf8');
  const result = instrumentStartup(source);
  for (const marker of ['module-loaded', 'root-render', 'font-status', 'content-render', 'content-effect']) {
    assert.ok(result.includes(`KC_STARTUP_DIAGNOSTIC ${marker}`));
  }
  const bootstrap = readFileSync(new URL('../app/apps/mobile/src/i18n/useLanguageBootstrap.ts', import.meta.url), 'utf8');
  const languageResult = instrumentLanguageBootstrap(bootstrap);
  assert.match(languageResult, /rtl-read-start/);
  assert.match(languageResult, /rtl-read-finished/);
  assert.match(languageResult, /rtl-needs-reload/);
  assert.match(languageResult, /rtl-reload-call/);
  assert.match(languageResult, /if \(needsReload\) \{[\s\S]*reloadApp\(\)/);
  assert.match(languageResult, /applyLayoutDirection\(desired\)/);
  assert.doesNotMatch(result, /console.warn\([^\n]*(stored|desired|userId|token)/);
  assert.throws(() => instrumentStartup(result), /anchor/);
  assert.throws(() => instrumentStartup(''), /anchor/);
  assert.throws(() => instrumentLanguageBootstrap(languageResult), /anchor/);
  assert.match(languageResult, /language-ready/);
  assert.doesNotMatch(languageResult, /console.warn\([^\n]*(stored|desired|userId|token)/);
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


test('private native capture includes info-level warning markers and bundled source proof', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ipad-guest-qualification.yml', import.meta.url), 'utf8');
  const reads = workflow.split('log show --last ').slice(1);
  assert.equal(reads.length, 3);
  for (const capture of reads) assert.match(capture.split('|| true')[0], /--info/);
  assert.match(workflow, /ipad-qualification-bundle-proof.mjs/);
});
