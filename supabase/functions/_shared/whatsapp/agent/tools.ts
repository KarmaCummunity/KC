// Issue #1091: the KC tool layer for the WhatsApp Pro agent (modeled on MySelf lib/agent/tools-*).
// Every tool is bound to ONE linked user (ctx.userId) resolved server-side by the webhook;
// the model can never choose whose data it reads or posts as. The tools reach posts through
// the api_bot_* RPCs (migration whatsapp_linking_and_bot_tools).

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
type Direction = 'give' | 'request';
/** The post kind slugs of public.post_kinds for the worlds the bot can post in. */
export const KIND: Record<World, Record<Direction, string>> = {
  items: { give: 'item_offer', request: 'item_request' },
  food: { give: 'food_offer', request: 'food_request' },
};
/** The post title limit of api_bot_apply_extraction. */
export const TITLE_MAX = 80;
const SUMMARY_MAX = 500;

/** What api_bot_publish_post returns. */
export type PublishResult = { post_id: string; status: 'open' | 'draft'; review: boolean; photo_required: boolean };
/** How the agent should describe a publish to the user. */
export type PublishOutcome = 'published' | 'draft_photo_required' | 'draft_staff_review';

function str(v: unknown, max: number): string {
  return String(v ?? '').trim().slice(0, max);
}
function world(v: unknown): World | null {
  return (WORLDS as readonly string[]).includes(String(v)) ? (v as World) : null;
}
function direction(v: unknown): Direction | null {
  return v === 'give' || v === 'request' ? v : null;
}
function confidence(v: unknown): number {
  const n = typeof v === 'number' ? v : Number.NaN;
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), 1) : 1;
}
/** A future ISO timestamp, or null when the value is missing, unparsable or past. */
export function futureIso(v: unknown, now = Date.now()): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) && t > now ? new Date(t).toISOString() : null;
}
async function call(ctx: ToolCtx, fn: string, args: Record<string, unknown>) {
  const { data, error } = await ctx.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

/** A photo outranks review: the owner has to act in the app before staff can approve. */
export function publishOutcome(r: PublishResult): PublishOutcome {
  if (r.status === 'open') return 'published';
  return r.photo_required ? 'draft_photo_required' : 'draft_staff_review';
}

async function postListing(ctx: ToolCtx, a: Record<string, unknown>) {
  const w = world(a.world);
  const dir = direction(a.direction);
  const title = str(a.title, TITLE_MAX);
  if (!w || !dir || !title) return { error: 'world_direction_title_required' };
  const needsExpiry = w === 'food' && dir === 'give';
  const expiresAt = needsExpiry ? futureIso(a.expires_at) : null;
  // A food offer needs the giver's own "good until"; the agent asks, it never guesses one.
  if (needsExpiry && !expiresAt) {
    return { error: 'food_expiry_required', ask_user: 'until when the food is good to eat' };
  }
  if (a.confirmed !== true) {
    return { error: 'needs_user_confirmation', preview: { world: w, direction: dir, title, expires_at: expiresAt } };
  }
  const sessionId = await call(ctx, 'api_bot_open_session', {
    p_wa_id: ctx.waId,
    p_inbound_message_id: ctx.recordId,
  });
  await call(ctx, 'api_bot_apply_extraction', {
    p_session_id: sessionId,
    p_world_slug: w,
    p_kind_slug: KIND[w][dir],
    p_direction: dir,
    p_title: title,
    p_details: expiresAt ? { expires_at: expiresAt } : {},
    p_confidence: confidence(a.confidence),
    p_summary: str(a.summary, SUMMARY_MAX) || null,
  });
  const published = (await call(ctx, 'api_bot_publish_post', {
    p_session_id: sessionId,
    p_owner_id: ctx.userId,
  })) as PublishResult;
  return { ok: true, ...published, outcome: publishOutcome(published) };
}

export const TOOLS: ToolDef[] = [
  {
    name: 'search_listings',
    description: 'Search open KC posts (items or food) people give or request. Returns up to 8 cards.',
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
      const cards = await call(ctx, 'api_bot_search_posts', {
        p_user_id: ctx.userId,
        p_query: query,
        p_world_slug: world(a.world),
        p_limit: 8,
      });
      return { results: cards ?? [] };
    },
  },
  {
    name: 'post_listing',
    description:
      'Create a post for the user (give or request an item or food). Only call with confirmed=true ' +
      'after the user explicitly approved the exact title in this conversation. A food offer needs ' +
      'expires_at, the time the user said the food is good until; ask for it, never guess it. ' +
      'The result says whether the post was published or stayed a draft (photo needed, or staff review).',
    parameters: {
      type: 'object',
      properties: {
        world: { type: 'string', enum: [...WORLDS] },
        direction: { type: 'string', enum: ['give', 'request'] },
        title: { type: 'string', description: `Short title, max ${TITLE_MAX} chars` },
        summary: { type: 'string', description: `Optional details, max ${SUMMARY_MAX} chars` },
        expires_at: { type: 'string', description: 'Food offers only: ISO 8601 date-time the user gave' },
        confidence: { type: 'number', description: 'How sure you are of the details, 0 to 1 (default 1)' },
        confirmed: { type: 'boolean', description: 'true only after explicit user approval' },
      },
      required: ['world', 'direction', 'title', 'confirmed'],
    },
    run: postListing,
  },
  {
    name: 'my_listings',
    description: 'The user\'s own open posts.',
    parameters: { type: 'object', properties: {} },
    run: async (ctx) => ({
      listings: (await call(ctx, 'api_bot_my_posts', { p_user_id: ctx.userId, p_limit: 10 })) ?? [],
    }),
  },
  {
    name: 'my_matches',
    description: 'Current match suggestions for the user\'s posts (who offers what they need, or needs what they offer).',
    parameters: { type: 'object', properties: {} },
    run: async (ctx) => ({
      matches: (await call(ctx, 'api_bot_my_matches', { p_user_id: ctx.userId, p_limit: 10 })) ?? [],
    }),
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
