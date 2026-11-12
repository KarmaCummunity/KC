// KC#1235 — contract between the Maestro flows and the app: every `id:` a flow taps or waits
// for must exist as a React Native testID in app/apps/mobile, so renaming a testID fails here
// (seconds) instead of on the emulator (tens of minutes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MAESTRO_DIR = join(ROOT, '.maestro');
const MOBILE_DIRS = ['app', 'src'].map((d) => join(ROOT, 'app', 'apps', 'mobile', d));

function walk(dir, keep) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : walk(path, keep);
    return keep(path) ? [path] : [];
  });
}

const flowFiles = walk(MAESTRO_DIR, (p) => p.endsWith('.yaml'));
const source = MOBILE_DIRS.flatMap((d) => walk(d, (p) => /\.tsx?$/.test(p) && !p.includes('__tests__')))
  .map((p) => readFileSync(p, 'utf8'))
  .join('\n');

/**
 * Ids used by flows: `id: foo` lines (Maestro element selectors). A quoted selector made only of ids
 * joined by `|` (`id: "a|b"`, either screen state is valid) contributes each alternative; a selector
 * with other regex syntax (`rides-feed-item-.*`) matches a family of ids and is not checked.
 */
function flowIds() {
  const ids = new Set();
  for (const file of flowFiles) {
    for (const [, id] of readFileSync(file, 'utf8').matchAll(/^\s*id:\s*"?([A-Za-z0-9_|-]+)"?\s*$/gm)) {
      for (const alternative of id.split('|')) ids.add(alternative);
    }
  }
  return [...ids].sort();
}

/**
 * True when the app renders `id` as a testID: a JSX literal (`testID="id"`), a literal in a
 * data table the screen maps over (`testID: 'id'`, e.g. hub tiles), or the tab bar's
 * `tab-${key}` template.
 */
function appHasTestId(id) {
  if (source.includes(`testID="${id}"`) || source.includes(`testID: '${id}'`)) return true;
  const tab = id.match(/^tab-(\w+)$/);
  if (tab && source.includes('testID={`tab-${tab.key}`}') && source.includes(`key: '${tab[1]}'`)) return true;
  const createCategory = id.match(/^create-category-([a-z0-9_]+)$/);
  if (createCategory && source.includes('testID={`create-category-${')) {
    const slug = createCategory[1];
    return source.includes(`${slug}: `) || source.includes(`${slug}: '`);
  }
  return false;
}

test('flows exist and every flow declares the KC app id', () => {
  assert.ok(flowFiles.length >= 10, `expected at least 10 flow files, found ${flowFiles.length}`);
  for (const file of flowFiles.filter((f) => !f.endsWith('config.yaml'))) {
    assert.match(readFileSync(file, 'utf8'), /^appId: org\.karmacommunity\.app$/m, file);
  }
});

test('every id used by a Maestro flow is a testID in the mobile app', () => {
  const missing = flowIds().filter((id) => !appHasTestId(id));
  assert.deepEqual(missing, [], `testIDs missing from app/apps/mobile: ${missing.join(', ')}`);
});

test('every flow under flows/ links to its spec section', () => {
  for (const file of flowFiles.filter((f) => f.includes(`${join('.maestro', 'flows')}`))) {
    assert.match(readFileSync(file, 'utf8'), /^# Spec: /m, `${file} has no "# Spec:" header`);
  }
});

test('system ANR dialogs from the emulator cannot cover the app', () => {
  // Run 4 of KC#1235: a "Pixel Launcher isn't responding" dialog hid the welcome screen in every flow.
  const runner = readFileSync(join(ROOT, 'scripts', 'maestro-run-android.sh'), 'utf8');
  assert.match(runner, /^adb shell settings put global hide_error_dialogs 1$/m);
  const gates = readFileSync(join(MAESTRO_DIR, 'subflows', 'dismiss-gates.yaml'), 'utf8');
  assert.match(gates, /visible: "isn't responding"[\s\S]*tapOn: "Wait"/);
});

test('the E2E build keeps email sign-in on: production builds hide it by default (#2134)', () => {
  // Every flow signs in through the welcome screen's email entry, which launchSurfaces.ts hides in a
  // build without EXPO_PUBLIC_ENVIRONMENT=development unless this override is set.
  const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'ci-maestro-android.yml'), 'utf8');
  assert.match(workflow, /^ {2}EXPO_PUBLIC_LAUNCH_EMAIL_AUTH: '1'$/m);
});

test('the Maestro debug output is uploaded: it lives in a hidden .maestro folder', () => {
  // Without this the screenshots, view hierarchy and maestro.log of a failed flow never reach the artifact.
  const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'ci-maestro-android.yml'), 'utf8');
  assert.match(workflow, /name: maestro-android[\s\S]*?include-hidden-files: true/);
});

test('the runner redacts the seed password from the output before it is uploaded', () => {
  // The debug output is uploaded (hidden folder), and Maestro writes every -e variable into it in plain text.
  const runner = readFileSync(join(ROOT, 'scripts', 'maestro-run-android.sh'), 'utf8');
  assert.match(runner, /maestro-redact\.mjs" "\$OUT_DIR"/);
});

test('a failed flow is retried once and a pass on the retry is reported, so the gate is not held by a blip on kc-dev', () => {
  const runner = readFileSync(join(ROOT, 'scripts', 'maestro-run-android.sh'), 'utf8');
  assert.match(runner, /run_flow "\$flow" "\$name-retry"/);
  assert.match(runner, /Maestro flows that passed only on retry/);
  assert.match(runner, /Maestro flows failed: /);
});

test('the Maestro workflow is a lane of the CI gate: reusable, secret passed by ci.yml, no job-level skip', () => {
  const lane = readFileSync(join(ROOT, '.github', 'workflows', 'ci-maestro-android.yml'), 'utf8');
  assert.match(lane, /^on:\n {2}workflow_call:\n {4}secrets:\n {6}E2E_SEED_PASSWORD:/m);
  // The gate sees one result for the lane, so a job that skips on its own would pass unnoticed.
  assert.doesNotMatch(lane, /^ {4}if:/m);
  const ci = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(ci, /^ {2}maestro:\n[\s\S]*?uses: \.\/\.github\/workflows\/ci-maestro-android\.yml/m);
  assert.match(ci, /needs: \[changes, hygiene, static, release, frontend, bundles, backend, edge, maestro\]/);
});
