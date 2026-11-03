import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASELINE_HEADERS, renderHeadersFile } from './web-headers.mjs';

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
