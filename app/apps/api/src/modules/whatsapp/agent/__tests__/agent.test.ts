import { describe, expect, it } from 'vitest';
import type { RpcFn } from '../../inbound/inboundMessages';
import { PUBLISH_OUTCOME_TEXT } from '../publishOutcomeText';
import { MAX_STEPS, runAgent, SYSTEM_PROMPT, systemPrompt } from '../run';
import { futureIso, KIND, publishOutcome, runTool, TITLE_MAX } from '../tools';

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

describe('WhatsApp Pro agent', () => {
  it('no Gemini key → disabled, no RPC, no reply', async () => {
    const calls: Call[] = [];
    expect(await runAgent({ rpc: rpc(calls), gemini: null }, INPUT)).toEqual({ status: 'disabled' });
    expect(calls.length).toEqual(0);
  });

  it('budget exhausted → no LLM call', async () => {
    const calls: Call[] = [];
    const seen: unknown[] = [];
    const r = await runAgent({ rpc: rpc(calls, { api_whatsapp_llm_budget_take: false }), gemini: scriptedGemini([[{ text: 'x' }]], seen) }, INPUT);
    expect(r.status).toEqual('budget_exceeded');
    expect(seen.length).toEqual(0);
  });

  it('tool call → result fed back → final text queued as reply, scoped to the linked user', async () => {
    const calls: Call[] = [];
    const seen: { contents: unknown[] }[] = [];
    const g = scriptedGemini([
      [{ functionCall: { name: 'search_listings', args: { query: 'ספה', world: 'items', p_owner_id: 'attacker' } } }],
      [{ text: 'מצאתי ספה למסירה.' }],
    ], seen);
    const r = await runAgent({ rpc: rpc(calls), gemini: g }, INPUT);
    expect(r.status).toEqual('replied');
    const search = calls.find((c) => c.fn === 'api_bot_search_posts')!;
    expect(search.args.p_user_id).toEqual('u-pro');
    expect(calls.some((c) => c.fn === 'api_bot_post_cards')).toEqual(false);
    expect(seen[1]!.contents.length).toEqual(3);
    const reply = calls.find((c) => c.fn === 'api_whatsapp_queue_reply')!;
    expect(reply.args.p_body).toEqual('מצאתי ספה למסירה.');
  });

  it('post_listing refuses without confirmation, publishes with it', async () => {
    const calls: Call[] = [];
    const ctx = { rpc: rpc(calls), userId: 'u-pro', waId: 'w', recordId: 'rec-1' };
    const args = { world: 'items', direction: 'request', title: 'Sofa', confirmed: false };
    const pending = await runTool(ctx, 'post_listing', args) as { error: string };
    expect(pending.error).toEqual('needs_user_confirmation');
    expect(calls.length).toEqual(0);
    const done = await runTool(ctx, 'post_listing', { ...args, confirmed: true }) as Record<string, unknown>;
    expect(done.post_id).toEqual('new-post');
    expect(done.outcome).toEqual('published');
    expect(calls.find((c) => c.fn === 'api_bot_open_session')!.args).toEqual({ p_wa_id: 'w', p_inbound_message_id: 'rec-1' });
    const extraction = calls.find((c) => c.fn === 'api_bot_apply_extraction')!.args;
    expect(extraction.p_kind_slug).toEqual('item_request');
    expect(extraction.p_confidence).toEqual(1);
    expect(calls.find((c) => c.fn === 'api_bot_publish_post')!.args).toEqual({ p_session_id: 's1', p_owner_id: 'u-pro' });
  });

  it('the kind map uses the post kinds of items and food', () => {
    expect(KIND).toEqual({
      items: { give: 'item_offer', request: 'item_request' },
      food: { give: 'food_offer', request: 'food_request' },
    });
  });

  it('post_listing caps the title at 80 characters and clamps the confidence', async () => {
    const calls: Call[] = [];
    const ctx = { rpc: rpc(calls), userId: 'u-pro', waId: 'w', recordId: null };
    await runTool(ctx, 'post_listing', { world: 'items', direction: 'give', title: 'x'.repeat(200), confidence: 7, confirmed: true });
    const extraction = calls.find((c) => c.fn === 'api_bot_apply_extraction')!.args;
    expect(String(extraction.p_title).length).toEqual(TITLE_MAX);
    expect(extraction.p_confidence).toEqual(1);
    expect(calls.find((c) => c.fn === 'api_bot_open_session')!.args.p_inbound_message_id).toEqual(null);
  });

  it('a food offer asks for its expiry and never invents one', async () => {
    const calls: Call[] = [];
    const ctx = { rpc: rpc(calls), userId: 'u-pro', waId: 'w', recordId: 'rec-1' };
    const base = { world: 'food', direction: 'give', title: 'Soup', confirmed: true };
    for (const expires_at of [undefined, '', 'tomorrow', '2001-01-01T10:00:00Z']) {
      const r = await runTool(ctx, 'post_listing', { ...base, expires_at }) as { error: string };
      expect(r.error).toEqual('food_expiry_required');
    }
    expect(calls.length).toEqual(0);
    const later = new Date(Date.now() + 86_400_000).toISOString();
    await runTool(ctx, 'post_listing', { ...base, expires_at: later });
    const extraction = calls.find((c) => c.fn === 'api_bot_apply_extraction')!.args;
    expect(extraction.p_kind_slug).toEqual('food_offer');
    expect(extraction.p_details).toEqual({ expires_at: later });
  });

  it('a food request needs no expiry', async () => {
    const calls: Call[] = [];
    const ctx = { rpc: rpc(calls), userId: 'u-pro', waId: 'w', recordId: 'rec-1' };
    await runTool(ctx, 'post_listing', { world: 'food', direction: 'request', title: 'Bread', confirmed: true });
    expect(calls.find((c) => c.fn === 'api_bot_apply_extraction')!.args.p_details).toEqual({});
  });

  it('a draft publish says why: photo first, then staff review', async () => {
    const draft = { post_id: 'p', status: 'draft' as const };
    expect(publishOutcome({ ...draft, review: false, photo_required: true })).toEqual('draft_photo_required');
    expect(publishOutcome({ ...draft, review: true, photo_required: true })).toEqual('draft_photo_required');
    expect(publishOutcome({ ...draft, review: true, photo_required: false })).toEqual('draft_staff_review');
    expect(publishOutcome({ post_id: 'p', status: 'open', review: false, photo_required: false })).toEqual('published');
    const calls: Call[] = [];
    const canned = { api_bot_publish_post: { ...draft, review: false, photo_required: true } };
    const ctx = { rpc: rpc(calls, canned), userId: 'u-pro', waId: 'w', recordId: 'rec-1' };
    const r = await runTool(ctx, 'post_listing', { world: 'items', direction: 'give', title: 'Sofa', confirmed: true });
    expect((r as { outcome: string }).outcome).toEqual('draft_photo_required');
    expect((r as { app_link: string }).app_link).toEqual('https://karma-community-kc.com/edit-post/p');
  });

  it('a draft carries its app link (photo here or finish in the app); a published post does not', async () => {
    const draft = { post_id: 'p9', status: 'draft', review: false, photo_required: true };
    const ctx = { rpc: rpc([], { api_bot_publish_post: draft }), userId: 'u', waId: 'w', recordId: null, appBaseUrl: 'https://dev.kc.test' };
    const food = await runTool(ctx, 'post_listing', {
      world: 'food', direction: 'give', title: 'Soup', expires_at: '2099-01-01T10:00:00Z', confirmed: true,
    });
    expect((food as { app_link: string }).app_link).toEqual('https://dev.kc.test/edit-listing/p9');
    const open = await runTool({ ...ctx, rpc: rpc([]) }, 'post_listing', { world: 'items', direction: 'request', title: 'Sofa', confirmed: true });
    expect((open as { app_link?: string }).app_link).toEqual(undefined);
    expect(PUBLISH_OUTCOME_TEXT.draft_photo_required.he.includes('{app_link}')).toEqual(true);
    expect(PUBLISH_OUTCOME_TEXT.draft_photo_required.en.includes('Send a photo here')).toEqual(true);
    expect(SYSTEM_PROMPT.includes('app_link')).toEqual(true);
  });

  it('a publish error reaches the model as a tool error', async () => {
    const failing: RpcFn = (fn) =>
      Promise.resolve(fn === 'api_bot_publish_post'
        ? { data: null, error: { message: 'rate_limited' } }
        : { data: 's1', error: null });
    const ctx = { rpc: failing, userId: 'u-pro', waId: 'w', recordId: null };
    const r = await runTool(ctx, 'post_listing', { world: 'items', direction: 'request', title: 'Sofa', confirmed: true });
    expect((r as { error: string }).error).toEqual('api_bot_publish_post: rate_limited');
  });

  it('the prompt tells every publish outcome in Hebrew and English, and the time', () => {
    for (const t of Object.values(PUBLISH_OUTCOME_TEXT)) {
      expect(SYSTEM_PROMPT.includes(t.he)).toEqual(true);
      expect(SYSTEM_PROMPT.includes(t.en)).toEqual(true);
    }
    expect(systemPrompt(new Date('2026-11-13T10:00:00Z')).includes('2026-11-13T10:00:00.000Z')).toEqual(true);
  });

  it('futureIso accepts only a parsable future time', () => {
    expect(futureIso('2030-01-01T00:00:00Z', Date.parse('2029-01-01T00:00:00Z'))).toEqual('2030-01-01T00:00:00.000Z');
    expect(futureIso('2028-01-01T00:00:00Z', Date.parse('2029-01-01T00:00:00Z'))).toEqual(null);
    expect(futureIso(42)).toEqual(null);
  });

  it('my_listings reads the member\'s own posts', async () => {
    const calls: Call[] = [];
    await runTool({ rpc: rpc(calls), userId: 'u-pro', waId: 'w', recordId: null }, 'my_listings', { p_user_id: 'x' });
    expect(calls).toEqual([{ fn: 'api_bot_my_posts', args: { p_user_id: 'u-pro', p_limit: 10 } }]);
  });

  it('unknown tool / bad world are tool errors, not crashes', async () => {
    const ctx = { rpc: rpc([]), userId: 'u', waId: 'w', recordId: null };
    expect(((await runTool(ctx, 'drop_db', {})) as { error: string }).error).toEqual('unknown_tool:drop_db');
    expect(((await runTool(ctx, 'post_listing', { world: 'money', direction: 'give', title: 't', confirmed: true })) as { error: string }).error).toEqual('world_direction_title_required');
  });

  it('loop is bounded by MAX_STEPS', async () => {
    const calls: Call[] = [];
    const seen: unknown[] = [];
    const g = scriptedGemini([[{ functionCall: { name: 'my_matches', args: {} } }]], seen);
    const r = await runAgent({ rpc: rpc(calls), gemini: g }, INPUT);
    expect(r.status).toEqual('empty');
    expect(seen.length).toEqual(MAX_STEPS);
  });
});
