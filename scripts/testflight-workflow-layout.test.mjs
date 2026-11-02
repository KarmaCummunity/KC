// Guards testflight-ios.yml layout: sparse resolver checkout must not touch the
// workspace root (pnpm reads app/package.json after a full root checkout).
// Run: node --test scripts/testflight-workflow-layout.test.mjs
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const WORKFLOW = '.github/workflows/testflight-ios.yml';

function checkoutBlocks(yaml) {
  return yaml.split(/(?=^\s*- uses: actions\/checkout@)/m).filter((b) => b.includes('actions/checkout@'));
}

test('testflight-ios keeps sparse checkout isolated from the build tree', () => {
  const yaml = readFileSync(WORKFLOW, 'utf8');
  assert.match(yaml, /path:\s*\.store-target/, 'resolver scripts checkout uses path .store-target');
  assert.doesNotMatch(yaml, /Disable sparse checkout/, 'no git sparse-checkout disable workaround');

  const blocks = checkoutBlocks(yaml);
  assert.ok(blocks.length >= 2, 'expected resolver + build checkouts');

  const rootCheckouts = blocks.filter((b) => !/^\s*path:/m.test(b.replace(/^[\s\S]*?with:\n/m, '')) && !b.includes('path: .store-target'));
  // Build checkout: no path key → workspace root; must not enable sparse-checkout.
  const buildCheckout = blocks.find((b) => b.includes('ref: ${{ steps.target.outputs.sha }}'));
  assert.ok(buildCheckout, 'build checkout at target SHA');
  assert.doesNotMatch(
    buildCheckout,
    /sparse-checkout:/,
    'build checkout at repo root must be a full tree',
  );

  const resolverCheckout = blocks.find((b) => b.includes('path: .store-target'));
  assert.match(resolverCheckout, /sparse-checkout:/, 'resolver checkout may be sparse under .store-target');
});
