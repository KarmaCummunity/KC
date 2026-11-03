// Issue #1091: the WhatsApp Pro agent loop (modeled on MySelf lib/agent/run.ts).
// Degrades cleanly: no GOOGLE_GENERATIVE_AI_API_KEY → no LLM call, no reply ('disabled').
// Budget: one api_whatsapp_llm_budget_take per inbound message (#938 per-phone/global caps).

import type { RpcFn } from '../sender.ts';
import { type Content, type GeminiConfig, generate } from './gemini.ts';
import { runTool, type ToolCtx, TOOLS } from './tools.ts';

export const MAX_STEPS = 5;
const MAX_REPLY = 1500;

export const SYSTEM_PROMPT = [
  'You are the personal WhatsApp assistant of Karma Community (KC), a free giving community in Israel.',
  'Help the user find and post items and food to give or request, and check their matches, using the tools.',
  'Answer in the language the user wrote in (Hebrew or English). Be short: WhatsApp-sized, no markdown tables.',
  'Never invent listings; only report what tools return. Never share phone numbers or private details.',
  'Before post_listing, show the exact title and ask the user to confirm; call it with confirmed=true only after a clear yes.',
  'Money, rides and other worlds are not supported here yet; point the user to the app for those.',
].join(' ');

export type AgentDeps = { rpc: RpcFn; gemini: GeminiConfig | null };
export type AgentInput = { waId: string; userId: string; text: string; recordId: string | null };
export type AgentResult =
  | { status: 'disabled' | 'budget_exceeded' | 'empty' }
  | { status: 'replied'; reply: string; steps: number; tools: string[] };

export async function runAgent(deps: AgentDeps, input: AgentInput): Promise<AgentResult> {
  if (!deps.gemini?.apiKey) return { status: 'disabled' };

  const { data: allowed, error: budgetErr } = await deps.rpc('api_whatsapp_llm_budget_take', { p_wa_id: input.waId });
  if (budgetErr) throw new Error(budgetErr.message);
  if (allowed === false) return { status: 'budget_exceeded' };

  const ctx: ToolCtx = { rpc: deps.rpc, userId: input.userId, waId: input.waId, recordId: input.recordId };
  const contents: Content[] = [{ role: 'user', parts: [{ text: input.text.slice(0, 2000) }] }];
  const functionDeclarations = TOOLS.map(({ name, description, parameters }) => ({ name, description, parameters }));
  const used: string[] = [];

  for (let step = 1; step <= MAX_STEPS; step++) {
    const out = await generate(deps.gemini, { system: SYSTEM_PROMPT, contents, functionDeclarations });
    contents.push(out); // keep the model turn verbatim (thought signatures)
    const calls = out.parts.filter((p) => p.functionCall);
    if (calls.length === 0) {
      const reply = out.parts.map((p) => p.text ?? '').join('').trim().slice(0, MAX_REPLY);
      if (!reply) return { status: 'empty' };
      const { error } = await deps.rpc('api_whatsapp_queue_reply', {
        p_wa_id: input.waId,
        p_body: reply,
        p_reply_kind: 'reply',
      });
      if (error) throw new Error(error.message);
      return { status: 'replied', reply, steps: step, tools: used };
    }
    const responses = [];
    for (const c of calls) {
      const { name, args } = c.functionCall!;
      used.push(name);
      const result = await runTool(ctx, name, args ?? {});
      responses.push({ functionResponse: { name, response: { result } } });
    }
    contents.push({ role: 'user', parts: responses });
  }
  return { status: 'empty' };
}

export function geminiFromEnv(get: (k: string) => string | undefined, fetchFn: typeof fetch): GeminiConfig | null {
  const apiKey = get('GOOGLE_GENERATIVE_AI_API_KEY') ?? '';
  if (!apiKey) return null;
  return { apiKey, model: get('GEMINI_MODEL_ID') || 'gemini-flash-latest', fetch: fetchFn };
}
