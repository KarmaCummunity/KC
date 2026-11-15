import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASELINE_HEADERS, HASHED_ASSETS_PATH, IMMUTABLE_CACHE_CONTROL, renderHeadersFile } from './web-headers.mjs';

test('every response gets the baseline headers', () => {
  const body = renderHeadersFile();
  const [firstBlock] = body.split('\n\n');

  assert.match(firstBlock, /^\/\*\n/);
  for (const [name, value] of Object.entries(BASELINE_HEADERS)) {
    assert.ok(firstBlock.includes(`  ${name}: ${value}`), `missing ${name}`);
  }
});

test('framing is denied by both the legacy and the CSP header', () => {
  assert.equal(BASELINE_HEADERS['X-Frame-Options'], 'DENY');
  assert.equal(BASELINE_HEADERS['Content-Security-Policy'], "frame-ancestors 'none'");
});

test('HSTS does not pin subdomains', () => {
  assert.doesNotMatch(BASELINE_HEADERS['Strict-Transport-Security'], /includeSubDomains/);
});

test('app-link manifests are served as JSON', () => {
  const body = renderHeadersFile();
  assert.match(body, /\/\.well-known\/apple-app-site-association\n {2}Content-Type: application\/json/);
  assert.match(body, /\/\.well-known\/assetlinks\.json\n {2}Content-Type: application\/json/);
});

test('the build identity file is never cached', () => {
  assert.match(renderHeadersFile(), /\/version\.json\n {2}Cache-Control: no-store/);
});

test('content-hashed bundles are cached for a year and never revalidated', () => {
  const body = renderHeadersFile();
  assert.equal(HASHED_ASSETS_PATH, '/_expo/static/*');
  assert.match(body, /\/_expo\/static\/\*\n {2}Cache-Control: public, max-age=31536000, immutable/);
  assert.equal(IMMUTABLE_CACHE_CONTROL, 'public, max-age=31536000, immutable');
});

test('only the hashed path is immutable: the shell, service worker and build identity are not', () => {
  const immutableBlocks = renderHeadersFile().split('\n\n').filter((block) => block.includes('immutable'));
  assert.equal(immutableBlocks.length, 1);
  assert.ok(immutableBlocks[0].startsWith('/_expo/static/*'));
});
