import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AX_PROBE, instrumentAppDelegate } from './ax-probe.mjs';

test('native probe adds bounded read-only window and accessibility flag capture', () => {
  const source = 'import UIKit\nfunc start() {\n return super.application(application, didFinishLaunchingWithOptions: launchOptions)\n}\n';
  const result = instrumentAppDelegate(source);
  assert.ok(result.includes('KCAXDiagnostic.install()'));
  assert.ok(result.includes('remaining = 240'));
  assert.ok(result.includes('depth < 28'));
  assert.ok(result.includes('windows.prefix(8)'));
  for (const flag of ['isKeyWindow', 'windowLevel', 'isAccessibilityElement', 'accessibilityElementsHidden', 'accessibilityViewIsModal', 'accessibilityIdentifier']) assert.ok(AX_PROBE.includes(flag));
  // Never change accessibility, route, environment, or application window state.
  assert.doesNotMatch(AX_PROBE, /(?:isHidden|isKeyWindow|isAccessibilityElement|accessibilityElementsHidden|accessibilityViewIsModal)\s*=/);
  assert.doesNotMatch(AX_PROBE, /accessibilityLabel|accessibilityValue|\.text\b|token|password|URLSession|UserDefaults|makeKeyAndVisible|swizzl|method_setImplementation/);
  assert.throws(() => instrumentAppDelegate(result), /anchor/);
  assert.throws(() => instrumentAppDelegate(''), /anchor/);
});

test('native AX probe is not referenced by store or normal application code', () => {
  for (const path of ['testflight-ios.yml', 'prod-store-build.yml', 'mobile-nightly.yml']) {
    assert.doesNotMatch(readFileSync(new URL(`../../../.github/workflows/${path}`, import.meta.url), 'utf8'), /native-diagnostics|KCAXDiagnostic|RawAXTests/);
  }
  assert.doesNotMatch(readFileSync(new URL('../../../app/apps/mobile/app/_layout.tsx', import.meta.url), 'utf8'), /KCAXDiagnostic|native-diagnostics|RawAXTests/);
});


test('private integration preserves original failure and forbids product mutation', () => {
  const workflow = readFileSync(new URL('../../../.github/workflows/ipad-guest-qualification.yml', import.meta.url), 'utf8');
  assert.match(workflow, /independent-xctest-status/);
  assert.match(workflow, /exit "\$initial_status"/);
  assert.match(workflow, /openssl cms -encrypt/);
  assert.match(workflow, /xctest-attachments/);
  assert.match(workflow, /CODE_SIGNING_ALLOWED=NO test-without-building/);
  assert.doesNotMatch(workflow, /upload-artifact/);
  const reader = readFileSync(new URL('./RawAXTests.swift', import.meta.url), 'utf8');
  assert.match(reader, /prefix\(131072\)/);
  assert.match(reader, /XCTAttachment/);
  assert.doesNotMatch(reader, /app\.(?:launch|activate|terminate)\(|\.tap\(|coordinate\(/);
  assert.match(reader, /runningForeground/);
});
