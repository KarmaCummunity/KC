import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flowProblems } from './check-maestro-flows.mjs';

const HEADER = 'appId: org.karmacommunity.app\nname: Sample\n---\n';

test('accepts a flow with a required step', () => {
  const text = `${HEADER}- runFlow: ../subflows/sign-in.yaml\n- tapOn:\n    id: tab-create\n- assertVisible:\n    id: unified-create-header\n`;
  assert.deepEqual(flowProblems('flows/ok.yaml', text), []);
});

test('rejects options indented under a bare command, the error that disabled flow 19 (KC#1619)', () => {
  const text = `${HEADER}- tapOn:\n    id: edit-profile-phone\n- hideKeyboard\n    optional: true\n`;
  assert.match(flowProblems('flows/19.yaml', text)[0], /^flows\/19\.yaml: YAML error: Implicit keys need to be on a single line/);
});

test('rejects a command name with a space even when the YAML parses', () => {
  const text = `${HEADER}- assertVisible:\n    id: feed-screen\n- "hideKeyboard optional": true\n`;
  assert.deepEqual(flowProblems('flows/quoted.yaml', text), [
    "flows/quoted.yaml: invalid command 'hideKeyboard optional' (a bare command takes no arguments)",
  ]);
});

test('finds an invalid command nested in runFlow, repeat and retry blocks', () => {
  const text = `${HEADER}- assertVisible:\n    id: feed-screen\n- repeat:\n    times: 2\n    commands:\n      - back now\n- runFlow:\n    when:\n      platform: Android\n    commands:\n      - retry:\n          commands:\n            - scroll down\n`;
  assert.deepEqual(flowProblems('flows/nested.yaml', text), [
    "flows/nested.yaml: invalid command 'back now' (a bare command takes no arguments)",
    "flows/nested.yaml: invalid command 'scroll down' (a bare command takes no arguments)",
  ]);
});

test('rejects a flow whose every step after sign-in is optional, since it checks nothing', () => {
  const text = `${HEADER}- runFlow: ../subflows/sign-in.yaml\n- tapOn:\n    id: tab-profile\n    optional: true\n- assertVisible:\n    id: edit-profile-save\n    optional: true\n`;
  assert.deepEqual(flowProblems('flows/all-optional.yaml', text), [
    'flows/all-optional.yaml: every step is optional or a runFlow, so the flow asserts nothing',
  ]);
});

test('a subflow may be all optional (dismiss-gates taps only what is there)', () => {
  const text = `${HEADER}- tapOn:\n    id: push-gate-decline\n    optional: true\n`;
  assert.deepEqual(flowProblems('subflows/dismiss-gates.yaml', text, { isSubflow: true }), []);
});

test('reports YAML that does not parse and a commands document that is not a list', () => {
  assert.match(flowProblems('flows/broken.yaml', `${HEADER}- tapOn: [unclosed\n`)[0], /^flows\/broken\.yaml: YAML error/);
  assert.deepEqual(flowProblems('flows/map.yaml', `${HEADER}tapOn: x\n`), [
    'flows/map.yaml: the commands document must be a list',
  ]);
});

test('rejects a flow name the artifact upload cannot store (it broke the upload of every run)', () => {
  const text = 'appId: org.karmacommunity.app\nname: \'Worlds: the "+" entry\'\n---\n- assertVisible:\n    id: feed-screen\n';
  assert.deepEqual(flowProblems('flows/quoted-name.yaml', text), [
    `flows/quoted-name.yaml: the flow name 'Worlds: the "+" entry' has a character the artifact upload rejects (one of " ' : < > | * ?)`,
  ]);
  assert.deepEqual(flowProblems('flows/ok-name.yaml', `${HEADER}- assertVisible:\n    id: feed-screen\n`), []);
});
