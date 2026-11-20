import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const workflow = parse(readFileSync(new URL('../.github/workflows/ci-pr.yml', import.meta.url), 'utf8'));
const step = workflow.jobs['pr-hygiene'].steps.find((s) => s.name === 'Refuse CI-skipping squash messages on dev');
async function run({ base = 'dev', title = 'fix(ci): safe title', body = 'Mapped to spec: INFRA-CI-3', messages = ['fix(ci): safe commit'] } = {}) {
  assert.ok(step, 'PR hygiene must contain the squash-message guard');
  const failures = [];
  let paginated = false;
  const github = {
    rest: { pulls: { listCommits: Symbol('listCommits') } },
    paginate: async (_method, args) => {
      paginated = true;
      assert.equal(args.per_page, 100);
      return messages.map((message) => ({ commit: { message } }));
    },
  };
  const context = { repo: { owner: 'fixture', repo: 'fixture' }, payload: { pull_request: { number: 1, title, body, base: { ref: base } } } };
  await new Function('github', 'context', 'core', `return (async () => {${step.with.script}\n})()`)(github, context, { setFailed: (m) => failures.push(m) });
  return { failures, paginated };
}
test('clean DEV PR passes; release/main flow is not changed', async () => {
  assert.deepEqual((await run()).failures, []);
  assert.equal((await run({ base: 'main', messages: ['historical [skip ci]'] })).paginated, false);
});
test('every documented bracket marker is refused anywhere in any generated message input', async () => {
  for (const marker of ['[skip ci]', '[ci skip]', '[no ci]', '[skip actions]', '[actions skip]', '[SKIP CI]']) {
    for (const input of [{ title: `fix(ci): text ${marker}` }, { body: `Mapped to spec\n${marker}` }, { messages: ['safe', `historical\n${marker}`] }]) {
      assert.equal((await run(input)).failures.length, 1);
    }
  }
});
test('trailer and commit pages beyond first page are inspected', async () => {
  const messages = Array.from({ length: 101 }, () => 'safe');
  messages.push('historical\n\nskip-checks: true');
  assert.equal((await run({ messages })).failures.length, 1);
  assert.equal((await run({ body: 'Mapped to spec\n\nskip-checks:true' })).failures.length, 1);
});
test('reject message explains recovery without printing commit contents', async () => {
  const result = await run({ messages: ['private-detail [skip ci]'] });
  assert.match(result.failures[0], /clean branch/);
  assert.doesNotMatch(result.failures[0], /private-detail/);
});
