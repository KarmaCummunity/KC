import { assertEquals } from 'jsr:@std/assert@1';
import type { RpcFn } from '../sender.ts';
import { geminiFromEnv, MAX_STEPS, runAgent } from './run.ts';
import { runTool } from './tools.ts';

type Call = { fn: string; args: Record<string, unknown> };

function rpc(calls: Call[], canned: Record<string, unknown> = {}): RpcFn {
  return (fn, args) => {
    calls.push({ fn, args });
    const base: Record<string, unknown> = {
      api_whatsapp_llm_budget_take: true,
      api_bot_search_listings: [{ listing_id: 'l1' }],
      api_bot_listing_cards: [{ listing_id: 'l1', title: 'Sofa', world_slug: 'items', direction: 'give' }],
      api_bot_open_session: 's1',
      api_bot_apply_extraction: 'e1',
      api_bot_publish_listing: 'new-listing',
      api_bot_my_matches: [],
      api_whatsapp_queue_reply: 'out-1',
      ...canned,
    };
    return Promise.resolve({ data: base[fn] ?? null, error: null });
  };
}

function scriptedGemini(turns: unknown[][], seen: unknown[] = []) {
  let i = 0;
  return {
    apiKey: 'test-key',
    model: 'test-model',
    fetch: (_url: string, init?: RequestInit) => {
      seen.push(JSON.parse(String(init?.body)));
      const parts = turns[Math.min(i++, turns.length - 1)];
      return Promise.resolve(new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts } }] })));
    },
  };
}

const INPUT = { waId: '972500000001', userId: 'u-pro', text: 'יש ספה?', recordId: 'rec-1' };

Deno.test('no Gemini key → disabled, no RPC, no reply', async () => {
  const calls: Call[] = [];
  assertEquals(await runAgent({ rpc: rpc(calls), gemini: null }, INPUT), { status: 'disabled' });
  assertEquals(calls.length, 0);
  assertEquals(geminiFromEnv(() => undefined, fetch), null);
});

Deno.test('budget exhausted → no LLM call', async () => {
  const calls: Call[] = [];
  const seen: unknown[] = [];
  const r = await runAgent({ rpc: rpc(calls, { api_whatsapp_llm_budget_take: false }), gemini: scriptedGemini([[{ text: 'x' }]], seen) }, INPUT);
  assertEquals(r.status, 'budget_exceeded');
  assertEquals(seen.length, 0);
});

Deno.test('tool call → result fed back → final text queued as reply, scoped to the linked user', async () => {
  const calls: Call[] = [];
  const seen: { contents: unknown[] }[] = [];
  const g = scriptedGemini([
    [{ functionCall: { name: 'search_listings', args: { query: 'ספה', world: 'items', p_owner_id: 'attacker' } } }],
    [{ text: 'מצאתי ספה למסירה.' }],
  ], seen);
  const r = await runAgent({ rpc: rpc(calls), gemini: g }, INPUT);
  assertEquals(r.status, 'replied');
  const search = calls.find((c) => c.fn === 'api_bot_search_listings')!;
  assertEquals(search.args.p_owner_id, 'u-pro');
  assertEquals(seen[1].contents.length, 3);
  const reply = calls.find((c) => c.fn === 'api_whatsapp_queue_reply')!;
  assertEquals(reply.args.p_body, 'מצאתי ספה למסירה.');
});

Deno.test('post_listing refuses without confirmation, publishes with it', async () => {
  const calls: Call[] = [];
  const ctx = { rpc: rpc(calls), userId: 'u-pro', waId: 'w', recordId: 'rec-1' };
  const pending = await runTool(ctx, 'post_listing', { world: 'food', direction: 'give', title: 'Soup', confirmed: false }) as { error: string };
  assertEquals(pending.error, 'needs_user_confirmation');
  assertEquals(calls.length, 0);
  const done = await runTool(ctx, 'post_listing', { world: 'food', direction: 'give', title: 'Soup', confirmed: true }) as { listing_id: string };
  assertEquals(done.listing_id, 'new-listing');
  assertEquals(calls.find((c) => c.fn === 'api_bot_apply_extraction')!.args.p_kind_slug, 'give_food');
  assertEquals(calls.find((c) => c.fn === 'api_bot_publish_listing')!.args.p_owner_id, 'u-pro');
});

Deno.test('unknown tool / bad world are tool errors, not crashes', async () => {
  const ctx = { rpc: rpc([]), userId: 'u', waId: 'w', recordId: null };
  assertEquals(((await runTool(ctx, 'drop_db', {})) as { error: string }).error, 'unknown_tool:drop_db');
  assertEquals(((await runTool(ctx, 'post_listing', { world: 'money', direction: 'give', title: 't', confirmed: true })) as { error: string }).error, 'world_direction_title_required');
});

Deno.test('loop is bounded by MAX_STEPS', async () => {
  const calls: Call[] = [];
  const seen: unknown[] = [];
  const g = scriptedGemini([[{ functionCall: { name: 'my_matches', args: {} } }]], seen);
  const r = await runAgent({ rpc: rpc(calls), gemini: g }, INPUT);
  assertEquals(r.status, 'empty');
  assertEquals(seen.length, MAX_STEPS);
});
