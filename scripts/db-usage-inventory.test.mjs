import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  OUTPUT_FILE,
  areaOf,
  blankComments,
  buildInventory,
  enclosingSymbol,
  literalsIn,
  readArgs,
  scanSources,
  summarize,
} from './db-usage-inventory.mjs';

const scan = (text, path = 'app/packages/infrastructure-supabase/src/demo/Repo.ts') => scanSources([{ path, text }]);
const names = (entries, kind) => entries.filter((e) => e.kind === kind).map((e) => e.name);

test('blankComments keeps offsets and leaves strings alone', () => {
  const source = "const a = 'x // not a comment'; // gone\n/* gone\n too */ const b = 1;";
  const out = blankComments(source);
  assert.equal(out.length, source.length);
  assert.match(out, /'x \/\/ not a comment'/);
  assert.doesNotMatch(out, /gone/);
  assert.equal(out.split('\n').length, 3);
});

test('readArgs splits top-level arguments only', () => {
  assert.deepEqual(readArgs("'a', { b: [1, 2] }, f(x, y))", 0), ["'a'", '{ b: [1, 2] }', 'f(x, y)']);
  assert.deepEqual(readArgs(')', 0), ['']);
});

test('literalsIn finds every literal of an expression', () => {
  assert.deepEqual(literalsIn("ok ? 'a_b' : \"c\""), ['a_b', 'c']);
  assert.deepEqual(literalsIn('fn as never'), []);
});

test('tables with their operations, single- and multi-line rpc calls', () => {
  const entries = scan(`
export class Repo {
  async load() {
    const { data } = await this.client.from('posts').select('*').eq('id', 1);
    await this.client
      .from('saved_posts')
      .delete()
      .eq('post_id', 1);
    return this.client.rpc(
      'feed_page',
      { p_limit: 1 },
    );
  }
}
// this.client.rpc('commented_out')
`);
  assert.deepEqual(names(entries, 'table'), ['posts', 'saved_posts']);
  assert.deepEqual(entries.filter((e) => e.kind === 'table').map((e) => e.ops), [['select'], ['delete']]);
  assert.deepEqual(names(entries, 'rpc'), ['feed_page']);
  assert.equal(entries[0].symbol, 'Repo.load');
  assert.equal(entries[0].area, 'demo');
});

test('an rpc name held in a constant, a union type or passed through a wrapper is resolved', () => {
  const entries = scan(`
const FN = 'by_constant';
type Action = 'pause_post' | 'resume_post';
export async function run(client: Client, action: Action) {
  await client.rpc(action, {});
  await client.rpc(FN);
}
class Inbox {
  private async call(fn: string, args?: object) {
    return this.client.rpc(fn as never, args as never);
  }
  page() {
    return this.call('notifications_page', {});
  }
}
`);
  assert.deepEqual(names(entries, 'rpc').sort(), ['by_constant', 'notifications_page', 'pause_post', 'resume_post']);
  assert.equal(entries.find((e) => e.name === 'notifications_page').via, 'wrapper:call');
  assert.equal(entries.find((e) => e.name === 'pause_post').via, 'type-union');
});

test('a bare rpc() helper call counts, its declaration does not', () => {
  const entries = scan(`
async function rpc(fn: string, args: object) {
  return supabase.rpc(fn, args);
}
export async function work() {
  await rpc('embedding_jobs_claim', { p_limit: 1 });
}
`, 'supabase/functions/embed-worker/index.ts');
  assert.deepEqual(names(entries, 'rpc'), ['embedding_jobs_claim']);
  assert.equal(entries[0].area, 'fn:embed-worker');
});

test('buckets, channels, postgres_changes and function invokes', () => {
  const entries = scan(`
const BUCKET = 'post-images';
export function wire(client, chatId) {
  client.storage.from(BUCKET).upload('a', b);
  const topic = \`chat:\${chatId}:messages\`;
  client
    .channel(topic)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chats' }, cb)
    .subscribe();
  client.functions.invoke<{ ok: boolean }>('translate', { body: {} });
  Array.from(new Set([1]));
}
`, 'app/apps/mobile/src/services/x.ts');
  assert.deepEqual(names(entries, 'bucket'), ['post-images']);
  assert.deepEqual(names(entries, 'channel'), ['topic = `chat:${chatId}:messages`']);
  assert.deepEqual(names(entries, 'postgres_changes'), ['chats']);
  assert.equal(entries.find((e) => e.kind === 'postgres_changes').event, 'UPDATE');
  assert.deepEqual(names(entries, 'edge_function'), ['translate']);
  assert.deepEqual(names(entries, 'table'), []);
  assert.equal(entries[0].area, 'mobile');
});

test('an unresolvable name is reported, not dropped', () => {
  const entries = scan('export function f(client, list) {\n  for (const b of list) client.storage.from(b).remove([]);\n}\n');
  assert.deepEqual(names(entries, 'bucket'), ['<b>']);
});

test('enclosingSymbol and areaOf', () => {
  const lines = ['export class A {', '  async m() {', '    if (x) {', '      call();', '    }', '  }', '}'];
  assert.equal(enclosingSymbol(lines, 4), 'A.m');
  assert.equal(enclosingSymbol(['call();'], 1), '<module>');
  assert.equal(areaOf('app/packages/infrastructure-supabase/src/client.ts'), '(root)');
  assert.equal(areaOf('supabase/functions/_shared/x.ts'), 'fn:_shared');
});

test('summarize counts call sites and distinct names per kind', () => {
  const summary = summarize([{ kind: 'rpc', name: 'a' }, { kind: 'rpc', name: 'a' }, { kind: 'table', name: 't' }]);
  assert.deepEqual(summary, { rpc: { callSites: 2, distinct: 1 }, table: { callSites: 1, distinct: 1 } });
});

test('the committed inventory matches the code', () => {
  assert.equal(existsSync(OUTPUT_FILE), true);
  const fresh = `${JSON.stringify(buildInventory(), null, 1)}\n`;
  assert.equal(readFileSync(OUTPUT_FILE, 'utf8') === fresh, true, 'run: node scripts/db-usage-inventory.mjs');
});
