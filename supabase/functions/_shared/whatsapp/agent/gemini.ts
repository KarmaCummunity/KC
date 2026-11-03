// Minimal Gemini generateContent client (REST, function calling). Env names match MySelf:
// GOOGLE_GENERATIVE_AI_API_KEY, GEMINI_MODEL_ID.

import type { FetchFn } from '../meta.ts';

export const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';

export type Part = {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
  thoughtSignature?: string;
};
export type Content = { role: 'user' | 'model'; parts: Part[] };

export type GeminiConfig = { apiKey: string; model: string; fetch: FetchFn };

export type GeminiRequest = {
  system: string;
  contents: Content[];
  functionDeclarations: { name: string; description: string; parameters: Record<string, unknown> }[];
};

export async function generate(cfg: GeminiConfig, req: GeminiRequest): Promise<Content> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`;
  const res = await cfg.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: req.contents,
      tools: [{ functionDeclarations: req.functionDeclarations }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
    }),
  });
  if (!res.ok) throw new Error(`gemini_http_${res.status}`);
  const body = (await res.json()) as { candidates?: { content?: Content }[] };
  const content = body.candidates?.[0]?.content;
  return { role: 'model', parts: content?.parts ?? [] };
}
