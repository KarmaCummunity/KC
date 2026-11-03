import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, after } from 'node:test';
import {
  REGISTRIES,
  applyAssignments,
  findMalformed,
  findPlaceholders,
  planAssignments,
  rowNumbers,
  validate,
} from './spec-ids.mjs';

const script = resolve(dirname(fileURLToPath(import.meta.url)), 'spec-ids.mjs');
const [DECISIONS, TECH_DEBT, , , ENGINEERING] = REGISTRIES;
const TECH_DEBT_HISTORY = TECH_DEBT.historyFiles[0];

const registries = (entries) => new Map(Object.entries(entries));

describe('spec-ids parsing', () => {
  it('reads numbered rows, including "needs depth" rows marked with *', () => {
    assert.deepEqual(rowNumbers('| D1 | a |\n| D6* | b |\n| text D9 |\n', DECISIONS), [1, 6]);
    assert.deepEqual(rowNumbers('| TD-12 | a |\n| TD-3 | b |\n', TECH_DEBT), [12, 3]);
  });

  it('reads engineering decisions from ## / ### headings', () => {
    const text = '## D-198 — a\n### D-41 — b\n#### D-7 — too deep\nsee D-5\n';
    assert.deepEqual(rowNumbers(text, ENGINEERING), [198, 41]);
  });

  it('finds well-formed placeholders and flags malformed ones', () => {
    const text = 'see {{TD:ci-window}} and {{D:Bad Slug}} and {{G:half}';
    assert.deepEqual(findPlaceholders(text), [{ token: '{{TD:ci-window}}', key: 'TD', slug: 'ci-window' }]);
    assert.deepEqual(findMalformed(text), ['{{D:Bad', '{{G:half}']);
  });
});

describe('spec-ids validate', () => {
  it('accepts placeholders defined by exactly one registry row', () => {
    const texts = registries({ [TECH_DEBT.file]: '| TD-1 | a |\n| {{TD:new-item}} | b |\n' });
    const citing = new Map([['docs/x.md', 'Tracked as {{TD:new-item}}.']]);
    assert.deepEqual(validate(texts, citing), []);
  });

  it('rejects a new duplicate number but tolerates the known legacy ones', () => {
    const texts = registries({ [TECH_DEBT.file]: '| TD-200 | a |\n| TD-200 | b |\n| TD-7 | c |\n| TD-7 | d |\n' });
    assert.deepEqual(validate(texts, new Map()), [`${TECH_DEBT.file}: TD-7 is used by more than one entry`]);
  });

  it('rejects a placeholder with no row, one defined twice, and a malformed one', () => {
    const registryText = '| {{D:twice}} | a |\n| {{D:twice}} | b |\n';
    const texts = registries({ [DECISIONS.file]: registryText });
    const citing = new Map([
      [DECISIONS.file, registryText],
      ['docs/y.md', 'per {{D:missing}} and {{TD:Nope}}'],
    ]);
    assert.deepEqual(validate(texts, citing), [
      `${DECISIONS.file}: {{D:twice}} is defined by more than one entry`,
      'docs/y.md: malformed placeholder {{TD:Nope}} (expected {{D/TD/S/G/ENG:lowercase-slug}})',
      `docs/y.md: {{D:missing}} has no entry in ${DECISIONS.file}`,
    ]);
  });

  it('does not accept a row in the wrong registry as a definition', () => {
    const texts = registries({ [DECISIONS.file]: '| {{TD:misplaced}} | a |\n' });
    const citing = new Map([['docs/z.md', '{{TD:misplaced}}']]);
    assert.deepEqual(validate(texts, citing), [`docs/z.md: {{TD:misplaced}} has no entry in ${TECH_DEBT.file}`]);
  });
});

describe('spec-ids assignment', () => {
  it('numbers placeholders in row order above the highest number ever used', () => {
    const plan = planAssignments(
      registries({
        [TECH_DEBT.file]: '| TD-10 | a |\n| {{TD:first}} | b |\n| {{TD:second}} | c |\n',
        [TECH_DEBT_HISTORY]: '| TD-42 | closed |\n',
        [DECISIONS.file]: '| D3 | a |\n| {{D:only}} | b |\n',
        [ENGINEERING.file]: '## D-199 — a\n## {{ENG:merge-time-ids}} — b\n',
      }),
    );
    assert.deepEqual([...plan], [
      ['{{D:only}}', 'D4'],
      ['{{TD:first}}', 'TD-43'],
      ['{{TD:second}}', 'TD-44'],
      ['{{ENG:merge-time-ids}}', 'D-200'],
    ]);
  });

  it('starts an empty registry at 1 and rewrites every citation', () => {
    const plan = planAssignments(registries({ [DECISIONS.file]: '| {{D:first-ever}} | a |\n' }));
    assert.equal(applyAssignments('per {{D:first-ever}}; again {{D:first-ever}}.', plan), 'per D1; again D1.');
  });
});

describe('spec-ids CLI', () => {
  const root = mkdtempSync(join(tmpdir(), 'kc-spec-ids-'));
  after(() => rmSync(root, { recursive: true, force: true }));

  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  const run = (command) =>
    spawnSync(process.execPath, [script, command], { env: { ...process.env, SPEC_IDS_ROOT: root }, encoding: 'utf8' });

  execFileSync('git', ['init', '-q'], { cwd: root });
  write(DECISIONS.file, '| # | Decision |\n|---|---|\n| D92 | old |\n| {{D:merge-time-ids}} | new |\n');
  write('docs/spec/notes.md', 'Decided in {{D:merge-time-ids}}.\n');
  execFileSync('git', ['add', '-A'], { cwd: root });

  it('check passes and reports the pending placeholder', () => {
    const result = run('check');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /1 placeholder\(s\) pending/);
  });

  it('assign rewrites the registry row and every citation', () => {
    const result = run('assign');
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(join(root, DECISIONS.file), 'utf8'), /^\| D93 \| new \|$/m);
    assert.equal(readFileSync(join(root, 'docs/spec/notes.md'), 'utf8'), 'Decided in D93.\n');
  });

  it('check fails on a citation with no registry row', () => {
    write('docs/spec/orphan.md', 'See {{G:never-defined}}.\n');
    execFileSync('git', ['add', '-A'], { cwd: root });
    const result = run('check');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /\{\{G:never-defined\}\} has no entry/);
  });
});
