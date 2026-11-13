import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  claimWinner,
  extractKeywords,
  isReservedForPerson,
  makeCommands,
  parseArgs,
  queueQuery,
} from './agent-task.mjs';

const HOUR = 3600_000;
const NOW = Date.parse('2026-11-13T12:00:00Z');
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

test('queueQuery keeps an issue open, prioritised and out of every reserved or busy state', () => {
  const q = queueQuery('P1');
  assert.match(q, /^repo:KarmaCummunity\/KC is:issue is:open label:priority:P1 /);
  for (const label of ['in-progress', 'blocked', 'needs-triage', 'human', 'maintainer-only', 'possible-duplicate', 'verification', 'epic']) {
    assert.ok(q.includes(`-label:${label}`), label);
  }
});

test('isReservedForPerson catches owner:* labels the search cannot exclude by wildcard', () => {
  assert.equal(isReservedForPerson(['priority:P0', 'owner:nave']), true);
  assert.equal(isReservedForPerson(['verification']), true);
  assert.equal(isReservedForPerson(['bug', 'area:mobile']), false);
});

test('claimWinner picks the earliest live claim after the last release, by session', () => {
  const comments = [
    { body: 'claimed by agent:cursor (session aaaaaa)', created_at: iso(10 * HOUR) },
    { body: 'released by agent:cursor: lost interest', created_at: iso(9 * HOUR) },
    { body: 'claimed by agent:claude (session bbbbbb)\n\n---\nfooter', created_at: iso(2) },
    { body: 'claimed by agent:claude (session cccccc)', created_at: iso(1) },
  ];
  assert.deepEqual(claimWinner(comments), { agent: 'claude', session: 'bbbbbb', at: iso(2) });
  assert.equal(claimWinner(comments.slice(0, 2)), null);
});

test('a lost race is withdrawn, not released: the winner keeps the claim', () => {
  const comments = [
    { body: 'claimed by agent:codex (session aaaaaa)', created_at: iso(3) },
    { body: 'claimed by agent:claude (session bbbbbb)', created_at: iso(2) },
    { body: 'withdrawn by agent:claude (session bbbbbb): lost the claim race', created_at: iso(1) },
  ];
  assert.deepEqual(claimWinner(comments), { agent: 'codex', session: 'aaaaaa', at: iso(3) });
});

test('extractKeywords keeps three distinctive words of a Hebrew or English title', () => {
  assert.deepEqual(extractKeywords('[URGENT] Require at least one photo for offered item'), ['require', 'least', 'photo']);
  assert.deepEqual(extractKeywords('באגים במסך יצירת פוסט - עולם האוכל'), ['באגים', 'במסך', 'יצירת']);
});

test('parseArgs reads the command, the issue number and the flags', () => {
  assert.deepEqual(parseArgs(['claim', '42', '--agent', 'codex']), { command: 'claim', issue: 42, flags: { agent: 'codex' } });
  assert.throws(() => parseArgs(['claim', '42', '--agent', 'robot']), /unknown agent/);
  assert.throws(() => parseArgs(['claim']), /issue number/);
  assert.throws(() => parseArgs(['release', '9', '--agent', 'claude', '--blocked', '--note', 'f']), /--blocked needs a value/);
  assert.deepEqual(parseArgs(['next', '--tech-debt']).flags, { 'tech-debt': true });
});

/** A scripted `gh api` double: each call returns the first matching canned response. */
function fakeGh(routes) {
  const calls = [];
  const gh = (args) => {
    calls.push(args.join(' '));
    const hit = routes.find(([pattern]) => pattern.test(args.join(' ')));
    return hit ? hit[1](args) : [];
  };
  return { gh, calls };
}

test('next prints the first priority with eligible issues and skips owner-reserved ones', () => {
  const { gh } = fakeGh([
    [/priority:launch/, () => ({ items: [{ number: 1, title: 'Store console', labels: [{ name: 'owner:nave' }] }] })],
    [/priority:P0/, () => ({ items: [{ number: 7, title: 'Fix feed', labels: [{ name: 'bug' }] }] })],
  ]);
  const out = makeCommands({ gh, now: () => NOW }).next({ limit: 5 });
  assert.deepEqual(out, ['priority:P0', '#7 Fix feed [bug]']);
});

test('claim wins, labels the issue and leaves the claim in place', () => {
  const comments = [];
  const { gh, calls } = fakeGh([
    [/issues\/9 --jq|^issues\/9$|repos\/KarmaCummunity\/KC\/issues\/9$/, () => ({ state: 'open', title: 't', labels: [] })],
    [/search\/issues/, () => ({ items: [] })],
    [/-X POST .*issues\/9\/comments/, (a) => { comments.push({ body: a[a.indexOf('-f') + 1].slice(5), created_at: iso(0) }); return {}; }],
    [/issues\/9\/comments/, () => comments],
  ]);
  const out = makeCommands({ gh, now: () => NOW, nonce: () => 'abc123', sleep: () => {} }).claim(9, { agent: 'claude' });
  assert.equal(out.at(-1), 'WON #9 as agent:claude (session abc123)');
  assert.ok(calls.some((c) => c.includes('labels[]=in-progress') && c.includes('labels[]=agent:claude')));
});

test('claim backs off when an earlier claim of another session won the race', () => {
  const comments = [{ body: 'claimed by agent:cursor (session zzzzzz)', created_at: iso(5) }];
  const { gh, calls } = fakeGh([
    [/repos\/KarmaCummunity\/KC\/issues\/9$/, () => ({ state: 'open', title: 't', labels: [] })],
    [/search\/issues/, () => ({ items: [] })],
    [/-X POST .*issues\/9\/comments/, (a) => { comments.push({ body: a[a.indexOf('-f') + 1].slice(5), created_at: iso(0) }); return {}; }],
    [/issues\/9\/comments/, () => comments],
  ]);
  const out = makeCommands({ gh, now: () => NOW, nonce: () => 'abc123', sleep: () => {} }).claim(9, { agent: 'claude' });
  assert.equal(out.at(-1), 'LOST #9 to agent:cursor (session zzzzzz)');
  assert.ok(calls.some((c) => c.includes('-X DELETE') && c.includes('labels/agent:claude')));
  assert.ok(!calls.some((c) => c.includes('-X DELETE') && c.includes('labels/in-progress')));
});

test('claim refuses an issue with a fresh claim or one reserved for a person', () => {
  const fresh = fakeGh([
    [/repos\/KarmaCummunity\/KC\/issues\/9$/, () => ({ state: 'open', title: 't', labels: [{ name: 'in-progress' }] })],
    [/issues\/9\/comments/, () => [{ body: 'claimed by agent:codex (session qqqqqq)', created_at: iso(HOUR) }]],
    [/search\/issues/, () => ({ items: [] })],
  ]);
  assert.match(makeCommands({ gh: fresh.gh, now: () => NOW }).claim(9, { agent: 'claude' }).at(-1), /^SKIP #9: claimed by agent:codex/);
  const reserved = fakeGh([[/repos\/KarmaCummunity\/KC\/issues\/9$/, () => ({ state: 'open', title: 't', labels: [{ name: 'human' }] })]]);
  assert.match(makeCommands({ gh: reserved.gh, now: () => NOW }).claim(9, { agent: 'claude' }).at(-1), /^SKIP #9: reserved for a person/);
});

test('release removes the claim, can mark the issue blocked and says why', () => {
  const { gh, calls } = fakeGh([[/.*/, () => ({})]]);
  makeCommands({ gh, now: () => NOW }).release(9, { agent: 'claude', blocked: 'waits on #2020' });
  assert.ok(calls.some((c) => c.includes('labels/in-progress')));
  assert.ok(calls.some((c) => c.includes('labels/agent:claude')));
  assert.ok(calls.some((c) => c.includes('labels[]=blocked')));
  assert.ok(calls.some((c) => c.includes('released by agent:claude: blocked on: waits on #2020')));
});

test('next reads a full page before dropping owner-reserved rows, so they cannot hide eligible issues', () => {
  const { gh, calls } = fakeGh([
    [/priority:launch/, () => ({ items: [
      { number: 1, title: 'Console', labels: [{ name: 'owner:nave' }] },
      { number: 2, title: 'Store', labels: [{ name: 'owner:nave' }] },
      { number: 3, title: 'Real work', labels: [{ name: 'bug' }] },
    ] })],
  ]);
  assert.deepEqual(makeCommands({ gh, now: () => NOW }).next({ limit: 1 }), ['priority:launch', '#3 Real work [bug]']);
  assert.ok(calls[0].includes('per_page=30'));
});

test('next --tech-debt lists unprioritised tech debt for the loop fallback', () => {
  const { gh, calls } = fakeGh([[/label:tech-debt/, () => ({ items: [{ number: 5, title: 'Split file', labels: [{ name: 'tech-debt' }] }] })]]);
  assert.deepEqual(makeCommands({ gh, now: () => NOW }).next({ 'tech-debt': true }), ['tech-debt', '#5 Split file [tech-debt]']);
  assert.ok(!calls[0].includes('label:priority'));
});

test('only a PR whose body cites #N counts as an open PR for issue N', () => {
  const { gh } = fakeGh([
    [/repos\/KarmaCummunity\/KC\/issues\/9$/, () => ({ state: 'open', title: 't', labels: [] })],
    [/is:pr/, () => ({ items: [{ number: 50, title: 'unrelated', body: 'raises the limit to 9 items' }] })],
    [/search\/issues/, () => ({ items: [] })],
    [/issues\/9\/comments/, () => []],
  ]);
  assert.equal(makeCommands({ gh, now: () => NOW }).check(9)[1], 'claimable: yes');
});

test('claim voids old claims when the labels were cleared without a release comment (sweep or merge)', () => {
  const comments = [{ body: 'claimed by agent:cursor (session oldold)', created_at: iso(9 * HOUR) }];
  const { gh } = fakeGh([
    [/repos\/KarmaCummunity\/KC\/issues\/9$/, () => ({ state: 'open', title: 't', labels: [] })],
    [/search\/issues/, () => ({ items: [] })],
    [/-X POST .*issues\/9\/comments/, (a) => { comments.push({ body: a[a.indexOf('-f') + 1].slice(5), created_at: iso(0) }); return {}; }],
    [/issues\/9\/comments/, () => comments],
  ]);
  const out = makeCommands({ gh, now: () => NOW, nonce: () => 'newnew', sleep: () => {} }).claim(9, { agent: 'claude' });
  assert.equal(out.at(-1), 'WON #9 as agent:claude (session newnew)');
  assert.match(comments[1].body, /^released by agent-task: no live claim/);
});

test('a same-agent loser keeps the shared agent label the winner needs', () => {
  const comments = [{ body: 'claimed by agent:claude (session first1)', created_at: iso(5) }];
  const { gh, calls } = fakeGh([
    [/repos\/KarmaCummunity\/KC\/issues\/9$/, () => ({ state: 'open', title: 't', labels: [] })],
    [/search\/issues/, () => ({ items: [] })],
    [/-X POST .*issues\/9\/comments/, (a) => { comments.push({ body: a[a.indexOf('-f') + 1].slice(5), created_at: iso(0) }); return {}; }],
    [/issues\/9\/comments/, () => comments],
  ]);
  const out = makeCommands({ gh, now: () => NOW, nonce: () => 'second', sleep: () => {} }).claim(9, { agent: 'claude' });
  assert.equal(out.at(-1), 'LOST #9 to agent:claude (session first1)');
  assert.ok(!calls.some((c) => c.includes('-X DELETE')));
  assert.match(comments.at(-1).body, /^withdrawn by agent:claude \(session second\)/);
});

test('release refuses a claim another agent holds unless forced, and checks the note first', () => {
  const held = fakeGh([[/issues\/9\/comments/, () => [{ body: 'claimed by agent:codex (session cccccc)', created_at: iso(1) }]], [/.*/, () => ({})]]);
  assert.match(makeCommands({ gh: held.gh, now: () => NOW }).release(9, { agent: 'claude' }).at(-1), /^REFUSED #9: held by agent:codex/);
  assert.ok(!held.calls.some((c) => c.includes('-X DELETE')));
  const missing = fakeGh([[/.*/, () => []]]);
  assert.throws(() => makeCommands({ gh: missing.gh, now: () => NOW }).release(9, { agent: 'claude', note: '/no/such/file' }), /note file not found/);
  assert.equal(missing.calls.length, 0);
});

test('claim re-reads after a pause, so a takeover posted meanwhile makes it lose', () => {
  const comments = [];
  const post = (body) => comments.push({ body, created_at: iso(0) });
  const { gh } = fakeGh([
    [/repos\/KarmaCummunity\/KC\/issues\/9$/, () => ({ state: 'open', title: 't', labels: [] })],
    [/search\/issues/, () => ({ items: [] })],
    [/-X POST .*issues\/9\/comments/, (a) => { post(a[a.indexOf('-f') + 1].slice(5)); return {}; }],
    [/issues\/9\/comments/, () => comments],
  ]);
  // While this session waits, another one voids the log and claims after it.
  const sleep = () => { post('released by agent-task: stale claim (over 6h, no open PR)'); post('claimed by agent:codex (session other1)'); };
  const out = makeCommands({ gh, now: () => NOW, nonce: () => 'mine01', sleep }).claim(9, { agent: 'claude' });
  assert.equal(out.at(-1), 'LOST #9 to agent:codex (session other1)');
});
