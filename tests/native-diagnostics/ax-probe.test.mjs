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
    assert.doesNotMatch(readFileSync(new URL(`../../.github/workflows/${path}`, import.meta.url), 'utf8'), /ipad-qualification-ax-probe/);
  }
  assert.doesNotMatch(readFileSync(new URL('../../app/apps/mobile/app/_layout.tsx', import.meta.url), 'utf8'), /KCAXDiagnostic|ipad-qualification-ax-probe/);
});
