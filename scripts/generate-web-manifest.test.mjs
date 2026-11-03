// The PWA manifest takes its colours from the design tokens, not from literals (spec 17 §2, #1290).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildManifest, readAppName, readBrandColours } from './generate-web-manifest.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** A throwaway repo root with a locale file and a token file. */
function fixtureRoot(tokens) {
  const root = mkdtempSync(join(tmpdir(), 'manifest-gen-'));
  const localeDir = join(root, 'app/apps/mobile/src/i18n/locales/he');
  mkdirSync(localeDir, { recursive: true });
  // ASCII fixture so the Hebrew-literal scan stays clean on this file.
  writeFileSync(join(localeDir, 'index.ts'), `export default { appName: 'TestApp Display Name' };`);
  const tokensDir = join(root, 'app/packages/ui/tokens');
  mkdirSync(tokensDir, { recursive: true });
  writeFileSync(join(tokensDir, 'kc.tokens.json'), JSON.stringify(tokens));
  return root;
}

test('builds the manifest from the locale name and the light backdrop / decoration tokens', () => {
  const root = fixtureRoot({ color: { light: { background: { $value: '#ABCDEF' }, primaryVivid: { $value: '#123456' } } } });
  try {
    const manifest = buildManifest(readAppName(root), readBrandColours(root));
    assert.equal(manifest.name, 'TestApp Display Name');
    assert.equal(manifest.background_color, '#ABCDEF');
    assert.equal(manifest.theme_color, '#123456');
    assert.equal(manifest.dir, 'rtl');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fails when a colour token is missing instead of falling back to a literal', () => {
  const root = fixtureRoot({ color: { light: { primaryVivid: { $value: '#123456' } } } });
  try {
    assert.throws(() => readBrandColours(root), /background/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the real token file yields the brand backdrop and the decoration orange', () => {
  const { background, themeColor } = readBrandColours(REPO_ROOT);
  assert.match(background, /^#[0-9A-Fa-f]{6}$/);
  assert.match(themeColor, /^#[0-9A-Fa-f]{6}$/);
  assert.notEqual(background.toUpperCase(), '#FFFFFF');
});
