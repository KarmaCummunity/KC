// Issue #1091: the KC tool layer for the WhatsApp Pro agent (modeled on MySelf lib/agent/tools-*).
// Every tool is bound to ONE linked user (ctx.userId) resolved server-side by the webhook;
// the model can never choose whose data it reads or posts as.

import type { RpcFn } from '../sender.ts';

export type ToolCtx = { rpc: RpcFn; userId: string; waId: string; recordId: string | null };

export type ToolDef = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run: (ctx: ToolCtx, args: Record<string, unknown>) => Promise<unknown>;
};

const WORLDS = ['items', 'food'] as const;
type World = (typeof WORLDS)[number];
const KIND: Record<World, Record<'give' | 'request', string>> = {
  items: { give: 'give_item', request: 'request_item' },
  food: { give: 'give_food', request: 'request_food' },
};

function str(v: unknown, max: number): string {
  return String(v ?? '').trim().slice(0, max);
}
function world(v: unknown): World | null {
  return (WORLDS as readonly string[]).includes(String(v)) ? (v as World) : null;
}
async function call(ctx: ToolCtx, fn: string, args: Record<string, unknown>) {
  const { data, error } = await ctx.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

export const TOOLS: ToolDef[] = [
  {
    name: 'search_listings',
    description: 'Search open KC listings (items or food) people give or request. Returns up to 8 cards.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to look for, in the user\'s words' },
        world: { type: 'string', enum: [...WORLDS], description: 'items or food; omit for both' },
      },
      required: ['query'],
    },
    run: async (ctx, a) => {
      const query = str(a.query, 200);
      if (!query) return { error: 'query_required' };
      const hits = (await call(ctx, 'api_bot_search_listings', {
        p_owner_id: ctx.userId,
        p_query: query,
        p_world_slug: world(a.world),
        p_limit: 8,
      })) as { listing_id: string }[] | null;
      const ids = (hits ?? []).map((h) => h.listing_id);
      if (ids.length === 0) return { results: [] };
      const cards = await call(ctx, 'api_bot_listing_cards', { p_viewer_id: ctx.userId, p_ids: ids });
      return { results: cards ?? [] };
    },
  },
  {
    name: 'post_listing',
    description:
      'Publish a listing for the user (give or request an item or food). Only call with confirmed=true ' +
      'after the user explicitly approved the exact title in this conversation.',
    parameters: {
      type: 'object',
      properties: {
        world: { type: 'string', enum: [...WORLDS] },
        direction: { type: 'string', enum: ['give', 'request'] },
        title: { type: 'string', description: 'Short title, max 120 chars' },
        summary: { type: 'string', description: 'Optional details, max 500 chars' },
        confirmed: { type: 'boolean', description: 'true only after explicit user approval' },
      },
      required: ['world', 'direction', 'title', 'confirmed'],
    },
    run: async (ctx, a) => {
      const w = world(a.world);
      const dir = a.direction === 'give' || a.direction === 'request' ? a.direction : null;
      const title = str(a.title, 120);
      if (!w || !dir || !title) return { error: 'world_direction_title_required' };
      if (a.confirmed !== true) return { error: 'needs_user_confirmation', preview: { world: w, direction: dir, title } };
      if (!ctx.recordId) return { error: 'no_inbound_record' };
      const sessionId = await call(ctx, 'api_bot_open_session', { p_wa_id: ctx.waId, p_record_id: ctx.recordId });
      await call(ctx, 'api_bot_apply_extraction', {
        p_session_id: sessionId,
        p_world_slug: w,
        p_kind_slug: KIND[w][dir],
        p_direction: dir,
        p_title: title,
        p_details: {},
        p_confidence: 1,
        p_summary: str(a.summary, 500) || null,
      });
      const listingId = await call(ctx, 'api_bot_publish_listing', { p_session_id: sessionId, p_owner_id: ctx.userId });
      return { ok: true, listing_id: listingId };
    },
  },
  {
    name: 'my_listings',
    description: 'The user\'s own open listings.',
    parameters: { type: 'object', properties: {} },
    run: async (ctx) => ({ listings: (await call(ctx, 'api_bot_my_listings', { p_user_id: ctx.userId, p_limit: 10 })) ?? [] }),
  },
  {
    name: 'my_matches',
    description: 'Current match suggestions for the user\'s listings (who offers what they need, or needs what they offer).',
    parameters: { type: 'object', properties: {} },
    run: async (ctx) => ({ matches: (await call(ctx, 'api_bot_my_matches', { p_user_id: ctx.userId, p_limit: 10 })) ?? [] }),
  },
];

export async function runTool(ctx: ToolCtx, name: string, args: Record<string, unknown>): Promise<unknown> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { error: `unknown_tool:${name}` };
  try {
    return await tool.run(ctx, args ?? {});
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
