import test from 'node:test';
import assert from 'node:assert/strict';
import { bundleHasStartupMarkers } from './ipad-qualification-bundle-proof.mjs';

test('compiled marker proof accepts JS or Hermes bytes without emitting bundle contents', () => {
  assert.equal(bundleHasStartupMarkers(Buffer.from('\0KC_STARTUP_DIAGNOSTIC module-loaded\0KC_STARTUP_DIAGNOSTIC rtl-read-start\0')), true);
  assert.equal(bundleHasStartupMarkers(Buffer.from('uninstrumented source')), false);
  assert.equal(bundleHasStartupMarkers(Buffer.from('KC_STARTUP_DIAGNOSTIC module-loaded')), false);
});
