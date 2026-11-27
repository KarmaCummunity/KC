import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('native root does not mount providers and navigation until language bootstrap is ready', () => {
  const source = readFileSync(new URL('../app/apps/mobile/app/_layout.tsx', import.meta.url), 'utf8');
  const root = source.slice(source.indexOf('export default function RootLayout()'));
  assert.match(root, /const languageReady = useLanguageBootstrap\(\);/);
  assert.ok(root.indexOf('if (!languageReady) return null;') < root.indexOf('<RootLayoutContent />'));
  assert.ok(root.indexOf('if (!languageReady) return null;') > root.indexOf('useLanguageBootstrap()'));
  const content = source.slice(source.indexOf('function RootLayoutContent()'), source.indexOf('export default function RootLayout()'));
  assert.doesNotMatch(content, /reloadApp|loadStoredLanguageAsync|applyLayoutDirection/);
});
