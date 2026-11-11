#!/usr/bin/env node
// Guard: every Maestro flow parses and checks something.
//
// Maestro rejects a bare command that carries anything after its name: in flow 19 an
// `optional: true` indented under `- hideKeyboard` turned the step into the single
// command "hideKeyboard optional", so the flow failed at parse time on every PR and
// never ran (KC#1619). The same flow marked every step optional, so even a working
// copy asserted nothing. The Maestro job is not a required check, so such a flow can
// sit broken unnoticed; this guard runs in the static lane of `CI gate` instead.
//
// Rules, per file under .maestro/flows and .maestro/subflows:
//   1. the YAML parses, and its last document (the commands) is a list;
//   2. no command name, at any nesting depth, contains whitespace (a bare string or a map key);
//   3. a flow (not a subflow) has at least one required step that is not a runFlow;
//   4. a `scrollUntilVisible` that scrolls down (the default) and is followed by a tap on the same
//      element sets `centerElement` explicitly. Without `true` Maestro stops as soon as the element
//      is inside the screen bounds, however much of it the floating tab bar covers, and the tap lands
//      on a tab (flows 10, 16 and 17 opened the wrong screen that way). `false` says nothing can cover
//      the element, for example a control at the top of the form that centering would scroll away;
//   5. a flow's `name` has none of the characters `actions/upload-artifact` rejects in a path.
//      Maestro names the debug folder of a flow after it, so one such character fails the upload
//      of the whole maestro-android artifact (reports, videos, screenshots) on every run.
//
// Usage: node scripts/check-maestro-flows.mjs   (exit 1 when a flow breaks a rule)

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAllDocuments } from 'yaml';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FLOW_DIRS = [
  { dir: '.maestro/flows', isSubflow: false },
  { dir: '.maestro/subflows', isSubflow: true },
];
/** Characters `actions/upload-artifact` refuses in a file path (the flow name becomes a folder). */
const ARTIFACT_UNSAFE_NAME_CHARS = /["':<>|*?\r\n]/;

/** A selector as a comparable key: `id:<id>` for `{ id }`, `text:<text>` for a string or `{ text }`. */
function selectorKey(selector) {
  if (typeof selector === 'string') return `text:${selector}`;
  if (selector?.id) return `id:${selector.id}`;
  if (selector?.text) return `text:${selector.text}`;
  return null;
}

/**
 * Elements a flow scrolls down to and then taps without an explicit `centerElement`, depth-first.
 * Only a tap right after the scroll counts: that is the step the floating tab bar can intercept.
 * @param {unknown[]} commands
 * @returns {string[]}
 */
function uncenteredScrollThenTap(commands) {
  const found = [];
  commands.forEach((command, i) => {
    if (!command || typeof command !== 'object') return;
    const scroll = command.scrollUntilVisible;
    const key = scroll ? selectorKey(scroll.element) : null;
    const next = commands[i + 1];
    const tapped = next && typeof next === 'object' ? selectorKey(next.tapOn) : null;
    const scrollsDown = !scroll?.direction || String(scroll.direction).toUpperCase() === 'DOWN';
    if (key && key === tapped && scrollsDown && typeof scroll.centerElement !== 'boolean') found.push(key);
    for (const name of NESTING_COMMANDS) {
      const nested = command[name]?.commands;
      if (Array.isArray(nested)) found.push(...uncenteredScrollThenTap(nested));
    }
  });
  return found;
}

/** Commands that carry nested command lists (`runFlow` inline, `repeat`, `retry`). */
const NESTING_COMMANDS = ['runFlow', 'repeat', 'retry'];

/**
 * Every command name with whitespace (bare string or map key), depth-first, including nested lists.
 * @param {unknown[]} commands
 * @returns {string[]}
 */
function invalidBareCommands(commands) {
  const found = [];
  for (const command of commands) {
    if (typeof command === 'string') {
      if (/\s/.test(command.trim())) found.push(command.trim().replace(/\s+/g, ' '));
      continue;
    }
    if (!command || typeof command !== 'object') continue;
    // A map command is `{ <name>: <args> }`; a name with whitespace is what Maestro reports as invalid.
    found.push(...Object.keys(command).filter((name) => /\s/.test(name)));
    for (const name of NESTING_COMMANDS) {
      const nested = command[name]?.commands;
      if (Array.isArray(nested)) found.push(...invalidBareCommands(nested));
    }
  }
  return found;
}

/**
 * True when a top-level step is required and is not a `runFlow` (it checks or does something).
 * A bare string command (`back`, `hideKeyboard`) is always required.
 * @param {unknown} command
 */
function isRequiredOwnStep(command) {
  if (typeof command === 'string') return true;
  if (!command || typeof command !== 'object') return false;
  const [name] = Object.keys(command);
  if (name === 'runFlow') return false;
  const args = command[name];
  return !(args && typeof args === 'object' && args.optional === true);
}

/**
 * Rule violations of one flow file, each as `<file>: <problem>`.
 * @param {string} file repository-relative path, used in messages
 * @param {string} text the file's content
 * @param {{ isSubflow?: boolean }} [options]
 * @returns {string[]}
 */
export function flowProblems(file, text, { isSubflow = false } = {}) {
  const documents = parseAllDocuments(text);
  const broken = documents.flatMap((doc) => doc.errors);
  if (broken.length > 0) return [`${file}: YAML error: ${broken[0].message.split('\n')[0]}`];
  const commands = documents.at(-1)?.toJS();
  if (!Array.isArray(commands)) return [`${file}: the commands document must be a list`];

  const problems = invalidBareCommands(commands).map(
    (command) => `${file}: invalid command '${command}' (a bare command takes no arguments)`,
  );
  for (const key of uncenteredScrollThenTap(commands)) {
    problems.push(`${file}: scrollUntilVisible to ${key} is followed by a tap on it, so it needs an explicit centerElement: true when the floating tab bar can cover it, false when nothing can`);
  }
  const flowName = documents.length > 1 ? documents[0].toJS()?.name : undefined;
  if (typeof flowName === 'string' && ARTIFACT_UNSAFE_NAME_CHARS.test(flowName)) {
    problems.push(`${file}: the flow name '${flowName}' has a character the artifact upload rejects (one of " ' : < > | * ?)`);
  }
  if (!isSubflow && !commands.some(isRequiredOwnStep)) {
    problems.push(`${file}: every step is optional or a runFlow, so the flow asserts nothing`);
  }
  return problems;
}

function main() {
  const problems = FLOW_DIRS.flatMap(({ dir, isSubflow }) =>
    readdirSync(join(REPO_ROOT, dir))
      .filter((name) => name.endsWith('.yaml'))
      .sort()
      .flatMap((name) => {
        const path = join(REPO_ROOT, dir, name);
        return flowProblems(relative(REPO_ROOT, path), readFileSync(path, 'utf8'), { isSubflow });
      }),
  );
  if (problems.length > 0) {
    for (const problem of problems) console.error(`✗ ${problem}`);
    process.exit(1);
  }
  console.log('✓ Maestro flow guard passed — every flow parses and checks something.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
