import { assertEquals } from 'jsr:@std/assert@1';
import type { RpcFn } from '../sender.ts';
import { geminiFromEnv, MAX_STEPS, PUBLISH_OUTCOME_TEXT, runAgent, SYSTEM_PROMPT, systemPrompt } from './run.ts';
import { futureIso, KIND, publishOutcome, runTool, TITLE_MAX } from './tools.ts';

type Call = { fn: string; args: Record<string, unknown> };

function rpc(calls: Call[], canned: Record<string, unknown> = {}): RpcFn {
  return (fn, args) => {
    calls.push({ fn, args });
    const base: Record<string, unknown> = {
      api_whatsapp_llm_budget_take: true,
      api_bot_search_posts: [{ post_id: 'p1', title: 'Sofa', world_slug: 'items', direction: 'offer' }],
      api_bot_open_session: 's1',
      api_bot_apply_extraction: 's1',
      api_bot_publish_post: { post_id: 'new-post', status: 'open', review: false, photo_required: false },
      api_bot_my_posts: [],
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
  const search = calls.find((c) => c.fn === 'api_bot_search_posts')!;
  assertEquals(search.args.p_user_id, 'u-pro');
  assertEquals(calls.some((c) => c.fn === 'api_bot_post_cards'), false);
  assertEquals(seen[1].contents.length, 3);
  const reply = calls.find((c) => c.fn === 'api_whatsapp_queue_reply')!;
  assertEquals(reply.args.p_body, 'מצאתי ספה למסירה.');
});

Deno.test('post_listing refuses without confirmation, publishes with it', async () => {
  const calls: Call[] = [];
  const ctx = { rpc: rpc(calls), userId: 'u-pro', waId: 'w', recordId: 'rec-1' };
  const args = { world: 'items', direction: 'request', title: 'Sofa', confirmed: false };
  const pending = await runTool(ctx, 'post_listing', args) as { error: string };
  assertEquals(pending.error, 'needs_user_confirmation');
  assertEquals(calls.length, 0);
  const done = await runTool(ctx, 'post_listing', { ...args, confirmed: true }) as Record<string, unknown>;
  assertEquals(done.post_id, 'new-post');
  assertEquals(done.outcome, 'published');
  assertEquals(calls.find((c) => c.fn === 'api_bot_open_session')!.args, { p_wa_id: 'w', p_inbound_message_id: 'rec-1' });
  const extraction = calls.find((c) => c.fn === 'api_bot_apply_extraction')!.args;
  assertEquals(extraction.p_kind_slug, 'item_request');
  assertEquals(extraction.p_confidence, 1);
  assertEquals(calls.find((c) => c.fn === 'api_bot_publish_post')!.args, { p_session_id: 's1', p_owner_id: 'u-pro' });
});

Deno.test('the kind map uses the post kinds of items and food', () => {
  assertEquals(KIND, {
    items: { give: 'item_offer', request: 'item_request' },
    food: { give: 'food_offer', request: 'food_request' },
  });
});

Deno.test('post_listing caps the title at 80 characters and clamps the confidence', async () => {
  const calls: Call[] = [];
  const ctx = { rpc: rpc(calls), userId: 'u-pro', waId: 'w', recordId: null };
  await runTool(ctx, 'post_listing', { world: 'items', direction: 'give', title: 'x'.repeat(200), confidence: 7, confirmed: true });
  const extraction = calls.find((c) => c.fn === 'api_bot_apply_extraction')!.args;
  assertEquals(String(extraction.p_title).length, TITLE_MAX);
  assertEquals(extraction.p_confidence, 1);
  assertEquals(calls.find((c) => c.fn === 'api_bot_open_session')!.args.p_inbound_message_id, null);
});

Deno.test('a food offer asks for its expiry and never invents one', async () => {
  const calls: Call[] = [];
  const ctx = { rpc: rpc(calls), userId: 'u-pro', waId: 'w', recordId: 'rec-1' };
  const base = { world: 'food', direction: 'give', title: 'Soup', confirmed: true };
  for (const expires_at of [undefined, '', 'tomorrow', '2001-01-01T10:00:00Z']) {
    const r = await runTool(ctx, 'post_listing', { ...base, expires_at }) as { error: string };
    assertEquals(r.error, 'food_expiry_required');
  }
  assertEquals(calls.length, 0);
  const later = new Date(Date.now() + 86_400_000).toISOString();
  await runTool(ctx, 'post_listing', { ...base, expires_at: later });
  const extraction = calls.find((c) => c.fn === 'api_bot_apply_extraction')!.args;
  assertEquals(extraction.p_kind_slug, 'food_offer');
  assertEquals(extraction.p_details, { expires_at: later });
});

Deno.test('a food request needs no expiry', async () => {
  const calls: Call[] = [];
  const ctx = { rpc: rpc(calls), userId: 'u-pro', waId: 'w', recordId: 'rec-1' };
  await runTool(ctx, 'post_listing', { world: 'food', direction: 'request', title: 'Bread', confirmed: true });
  assertEquals(calls.find((c) => c.fn === 'api_bot_apply_extraction')!.args.p_details, {});
});

Deno.test('a draft publish says why: photo first, then staff review', async () => {
  const draft = { post_id: 'p', status: 'draft' as const };
  assertEquals(publishOutcome({ ...draft, review: false, photo_required: true }), 'draft_photo_required');
  assertEquals(publishOutcome({ ...draft, review: true, photo_required: true }), 'draft_photo_required');
  assertEquals(publishOutcome({ ...draft, review: true, photo_required: false }), 'draft_staff_review');
  assertEquals(publishOutcome({ post_id: 'p', status: 'open', review: false, photo_required: false }), 'published');
  const calls: Call[] = [];
  const canned = { api_bot_publish_post: { ...draft, review: false, photo_required: true } };
  const ctx = { rpc: rpc(calls, canned), userId: 'u-pro', waId: 'w', recordId: 'rec-1' };
  const r = await runTool(ctx, 'post_listing', { world: 'items', direction: 'give', title: 'Sofa', confirmed: true });
  assertEquals((r as { outcome: string }).outcome, 'draft_photo_required');
});

Deno.test('a publish error reaches the model as a tool error', async () => {
  const failing: RpcFn = (fn) =>
    Promise.resolve(fn === 'api_bot_publish_post'
      ? { data: null, error: { message: 'rate_limited' } }
      : { data: 's1', error: null });
  const ctx = { rpc: failing, userId: 'u-pro', waId: 'w', recordId: null };
  const r = await runTool(ctx, 'post_listing', { world: 'items', direction: 'request', title: 'Sofa', confirmed: true });
  assertEquals((r as { error: string }).error, 'api_bot_publish_post: rate_limited');
});

Deno.test('the prompt tells every publish outcome in Hebrew and English, and the time', () => {
  for (const t of Object.values(PUBLISH_OUTCOME_TEXT)) {
    assertEquals(SYSTEM_PROMPT.includes(t.he), true);
    assertEquals(SYSTEM_PROMPT.includes(t.en), true);
  }
  assertEquals(systemPrompt(new Date('2026-11-13T10:00:00Z')).includes('2026-11-13T10:00:00.000Z'), true);
});

Deno.test('futureIso accepts only a parsable future time', () => {
  assertEquals(futureIso('2030-01-01T00:00:00Z', Date.parse('2029-01-01T00:00:00Z')), '2030-01-01T00:00:00.000Z');
  assertEquals(futureIso('2028-01-01T00:00:00Z', Date.parse('2029-01-01T00:00:00Z')), null);
  assertEquals(futureIso(42), null);
});

Deno.test('my_listings reads the member\'s own posts', async () => {
  const calls: Call[] = [];
  await runTool({ rpc: rpc(calls), userId: 'u-pro', waId: 'w', recordId: null }, 'my_listings', { p_user_id: 'x' });
  assertEquals(calls, [{ fn: 'api_bot_my_posts', args: { p_user_id: 'u-pro', p_limit: 10 } }]);
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
