// Guards the Node version contract of the app workspace (#1750).
//
// vitest 4 loads `std-env` through require(ESM), which Node enables by default only from
// 22.12.0. CI is safe because setup-node resolves `.nvmrc` (`22`) to the newest 22.x, but a
// local 22.0–22.11 dies with an opaque ERR_REQUIRE_ESM. The `engines.node` floor in
// app/package.json makes pnpm name the required version instead; these checks keep that
// floor and `.nvmrc` from drifting apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
/** Lowest Node release that enables require(ESM) by default on the 22 line. */
const REQUIRE_ESM_FLOOR = [22, 12, 0];

/** Parses `>=MAJOR.MINOR.PATCH` (the only range form this contract uses). */
function parseFloor(range) {
  const match = /^>=(\d+)\.(\d+)\.(\d+)$/.exec(range ?? '');
  assert.ok(match, `engines.node must be ">=MAJOR.MINOR.PATCH", got ${JSON.stringify(range)}`);
  return match.slice(1).map(Number);
}

/** Lexicographic compare of [major, minor, patch] tuples. */
function compare(a, b) {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

const appPackage = JSON.parse(readFileSync(`${ROOT}app/package.json`, 'utf8'));
const floor = parseFloor(appPackage.engines?.node);

test('engines.node floor enables require(ESM) for vitest', () => {
  assert.ok(compare(floor, REQUIRE_ESM_FLOOR) >= 0, `floor ${floor.join('.')} is below ${REQUIRE_ESM_FLOOR.join('.')}`);
});

test('.nvmrc names the same major as the engines floor', () => {
  const nvmMajor = Number(readFileSync(`${ROOT}.nvmrc`, 'utf8').trim().split('.')[0]);
  assert.equal(nvmMajor, floor[0], '.nvmrc and app/package.json engines.node disagree on the Node major');
});

test('the floor parser refuses any other range form', () => {
  assert.throws(() => parseFloor('^22'), /MAJOR\.MINOR\.PATCH/);
  assert.throws(() => parseFloor(undefined), /MAJOR\.MINOR\.PATCH/);
  assert.deepEqual(parseFloor('>=22.12.0'), [22, 12, 0]);
});
