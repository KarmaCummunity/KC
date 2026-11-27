// KC#1235 — contract between the Maestro flows and the app: every `id:` a flow taps or waits
// for must exist as a React Native testID in app/apps/mobile, so renaming a testID fails here
// (seconds) instead of on the emulator (tens of minutes).
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
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
 * data table the screen maps over (`testID: 'id'`, e.g. hub tiles), a form section's
 * `errorTestID="id"`, or the tab bar's
 * `tab-${key}` template.
 */
function appHasTestId(id) {
  if (source.includes(`testID="${id}"`) || source.includes(`testID: '${id}'`)) return true;
  // `FormSection` renders its `errorTestID` prop as the testID of the error message under a field.
  if (source.includes(`errorTestID="${id}"`)) return true;
  const tab = id.match(/^tab-(\w+)$/);
  if (tab && source.includes('testID={`tab-${tab.key}`}') && source.includes(`key: '${tab[1]}'`)) return true;
  const createCategory = id.match(/^create-category-([a-z0-9_]+)$/);
  if (createCategory && source.includes('testID={`create-category-${')) {
    const slug = createCategory[1];
    return source.includes(`${slug}: `) || source.includes(`${slug}: '`);
  }
  // Admin dashboard cards: `testID={`admin-card-${c.key}`}` with `key: 'onboardingReplay'`, …
  const adminCard = id.match(/^admin-card-([A-Za-z0-9_]+)$/);
  if (adminCard && source.includes('testID={`admin-card-${')) {
    const key = adminCard[1];
    return source.includes(`key: '${key}'`) || source.includes(`key: "${key}"`);
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
  // The retry waits for kc-dev to sign someone in first: a deploy can leave it unable to for minutes.
  assert.match(runner, /if ! node "\$\(dirname "\$0"\)\/maestro-wait-kc-dev\.mjs"; then[\s\S]*run_flow "\$flow" "\$name-retry"/);
  assert.match(runner, /Maestro flows that passed only on retry/);
  assert.match(runner, /Maestro flows failed: /);
});

test('the runner stops early, failed and with the reason, when kc-dev is down or flows keep failing (no hour-long grind)', () => {
  const runner = readFileSync(join(ROOT, 'scripts', 'maestro-run-android.sh'), 'utf8');
  assert.match(runner, /result="failed \(kc-dev unavailable\)"\n\s+failed\+=\("\$name"\)/);
  assert.match(runner, /KC_MAESTRO_MAX_CONSECUTIVE_FAILS:-3/);
  assert.match(runner, /::error::Maestro stopped early: \$stop_reason\. Not run/);
  // Stopping early never turns into a pass: the failed list still decides the exit status.
  assert.match(runner, /if \(\(\$\{#failed\[@\]\} > 0\)\); then\n\s+echo "::error::Maestro flows failed: \$\{failed\[\*\]\}"\n\s+exit 1/);
});

test('the Maestro workflow is a lane of the CI gate: reusable, secret passed by ci.yml, no job-level skip', () => {
  const lane = readFileSync(join(ROOT, '.github', 'workflows', 'ci-maestro-android.yml'), 'utf8');
  assert.match(lane, /^on:\n {2}workflow_call:\n(?: {4}inputs:\n(?: {6,}.*\n)+)? {4}secrets:\n {6}E2E_SEED_PASSWORD:/m);
  // The only input lets maestro-dev-health.yml give its turn to the merge queue; it defaults off and
  // ci.yml (merge groups, PRs) never passes it.
  assert.match(lane, /yield_to_queue:\n[\s\S]*?default: false/);
  // The gate sees one result for the lane, so a job that skips on its own would pass unnoticed.
  assert.doesNotMatch(lane, /^ {4}if:/m);
  const ci = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(ci, /^ {2}maestro:\n[\s\S]*?uses: \.\/\.github\/workflows\/ci-maestro-android\.yml/m);
  assert.doesNotMatch(ci, /yield_to_queue/);
  assert.match(ci, /needs: \[changes, hygiene, static, release, frontend, bundles, backend, edge, maestro\]/);
});


test('shared sign-in keeps a caller email and defaults only when none is supplied', () => {
  const flow = readFileSync(join(MAESTRO_DIR, 'subflows', 'sign-in.yaml'), 'utf8');
  const value = flow.match(/^  KC_E2E_EMAIL: (.+)$/m)?.[1];
  assert.ok(value?.startsWith('${') && value.endsWith('}'), 'the shared helper must evaluate a default, not overwrite callers');
  const expression = value.slice(2, -1);
  assert.equal(runInNewContext(expression, { KC_E2E_EMAIL: 'admin1@seed.kc.test' }), 'admin1@seed.kc.test');
  assert.equal(runInNewContext(expression, { KC_E2E_EMAIL: 'user1@seed.kc.test' }), 'user1@seed.kc.test');
  assert.equal(runInNewContext(expression, { KC_E2E_EMAIL: undefined }), 'user1@seed.kc.test');
  assert.equal(runInNewContext(expression, {}), 'user1@seed.kc.test');
  for (const name of ['23-admin-onboarding-replay.yaml', '24-admin-onboarding-replay-exit.yaml']) {
    const adminFlow = readFileSync(join(MAESTRO_DIR, 'flows', name), 'utf8');
    assert.match(adminFlow, /file: ..\/subflows\/sign-in.yaml\n    env:\n      KC_E2E_EMAIL: admin1@seed.kc.test/);
  }
  assert.match(readFileSync(join(MAESTRO_DIR, 'flows', '23-admin-onboarding-replay.yaml'), 'utf8'), /assertVisible: "E2E Admin 1"/);
});
