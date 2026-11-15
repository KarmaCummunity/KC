import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { androidPathPrefixes, validate, validateDist } from './check-well-known-links.mjs';

const FP_A = Array.from({ length: 32 }, (_, i) => (i * 7 % 256).toString(16).padStart(2, '0').toUpperCase()).join(':');
const FP_B = Array.from({ length: 32 }, (_, i) => (i * 11 % 256).toString(16).padStart(2, '0').toUpperCase()).join(':');
const appJson = {
  expo: {
    ios: { bundleIdentifier: 'org.karmacommunity.app', associatedDomains: ['applinks:kc.example', 'webcredentials:kc.example'] },
    android: {
      package: 'org.karmacommunity.app',
      intentFilters: [{ data: [{ scheme: 'https', host: 'kc.example', pathPrefix: '/post' }, { scheme: 'https', host: 'other.example', pathPrefix: '/x' }] }],
    },
  },
};
const good = () => ({
  appJson,
  aasa: {
    applinks: { details: [{ appID: 'ABCDE12345.org.karmacommunity.app', paths: ['/auth/callback*', '/sign-in', '/post/*'] }] },
    webcredentials: { apps: ['ABCDE12345.org.karmacommunity.app'] },
  },
  assetlinks: [{ target: { namespace: 'android_app', package_name: 'org.karmacommunity.app', sha256_cert_fingerprints: [FP_A, FP_B] } }],
});

test('valid manifests pass', () => assert.deepEqual(validate(good()), []));

test('android path prefixes are read per host', () => assert.deepEqual(androidPathPrefixes(appJson, 'kc.example'), ['/post']));

test('placeholders and a wrong bundle id fail', () => {
  const m = good();
  m.aasa.applinks.details[0].appID = 'REPLACE_WITH_APPLE_TEAM_ID.org.karmacommunity.app';
  assert.match(validate(m).join('\n'), /AASA appID/);
  m.aasa.applinks.details[0].appID = 'ABCDE12345.com.karmacommunity.app';
  assert.match(validate(m).join('\n'), /AASA appID/);
});

test('a path the app claims but AASA omits fails', () => {
  const m = good();
  m.aasa.applinks.details[0].paths = ['/sign-in'];
  const out = validate(m).join('\n');
  assert.match(out, /\/auth\/callback/);
  assert.match(out, /\/post/);
});

test('assetlinks needs two valid, distinct fingerprints and the right package', () => {
  const m = good();
  m.assetlinks[0].target.sha256_cert_fingerprints = ['REPLACE_WITH_ANDROID_RELEASE_SHA256'];
  const out = validate(m).join('\n');
  assert.match(out, /2 SHA-256 fingerprints/);
  assert.match(out, /not a colon-separated/);
  m.assetlinks[0].target.sha256_cert_fingerprints = [FP_A, FP_A];
  assert.match(validate(m).join('\n'), /twice/);
  m.assetlinks[0].target.package_name = 'com.karmacommunity.app';
  assert.match(validate(m).join('\n'), /package_name/);
});

test('webcredentials must list the app when app.json declares the domain', () => {
  const m = good();
  delete m.aasa.webcredentials;
  assert.match(validate(m).join('\n'), /webcredentials/);
});

test('validateDist wants both files shipped unchanged and served as JSON', () => {
  const dist = mkdtempSync(join(tmpdir(), 'wk-'));
  mkdirSync(join(dist, '.well-known'));
  const src = (n) => `content of ${n}`;
  assert.equal(validateDist(dist, src).length, 4);
  for (const n of ['apple-app-site-association', 'assetlinks.json']) writeFileSync(join(dist, '.well-known', n), src(n));
  writeFileSync(
    join(dist, '_headers'),
    '/.well-known/apple-app-site-association\n  Content-Type: application/json\n\n/.well-known/assetlinks.json\n  Content-Type: application/json\n',
  );
  assert.deepEqual(validateDist(dist, src), []);
  writeFileSync(join(dist, '.well-known', 'assetlinks.json'), 'edited');
  assert.match(validateDist(dist, src).join('\n'), /differs from public/);
});
