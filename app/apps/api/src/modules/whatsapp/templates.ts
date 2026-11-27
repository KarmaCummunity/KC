// The WhatsApp template registry (issue #936). `templates.json` is the registry; this module
// validates and resolves it for the sender. While the Edge Function exists the file is a
// copy of `supabase/functions/_shared/whatsapp/templates.json`, and a test fails when the
// two differ.
//
// Ported from `supabase/functions/_shared/whatsapp/templates.ts`.

import registry from './templates.json';

export const TEMPLATE_LANGUAGES = ['he', 'en'] as const;
export type TemplateLanguage = (typeof TEMPLATE_LANGUAGES)[number];

export type TemplateVariant = { body: string; examples: string[] };
export type TemplateDef = {
  name: string;
  category: 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';
  purpose: string;
  params: string[];
  languages: Record<TemplateLanguage, TemplateVariant>;
};

export const TEMPLATES: readonly TemplateDef[] = registry.templates as TemplateDef[];

/** Names the bot code refers to — always go through these constants, never string literals. */
export const TEMPLATE = {
  matchFound: 'match_found_v1',
  confirmHandoff: 'confirm_handoff_v1',
  reminder: 'reminder_v1',
  optInConfirm: 'opt_in_confirm_v1',
} as const;

/** The template of that name, or undefined. */
export function getTemplate(name: string): TemplateDef | undefined {
  return TEMPLATES.find((t) => t.name === name);
}

/** The highest `{{n}}` placeholder of a body; 0 when it has none. */
export function placeholderCount(body: string): number {
  const nums = [...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  return nums.length === 0 ? 0 : Math.max(...nums);
}

/** Static checks mirroring Meta's template rules; returns human-readable problems. */
export function validateRegistry(list: readonly TemplateDef[] = TEMPLATES): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const t of list) {
    if (!/^[a-z0-9_]{1,512}$/.test(t.name)) problems.push(`${t.name}: name must be lowercase a-z0-9_`);
    if (!/_v\d+$/.test(t.name)) problems.push(`${t.name}: name must end with a _vN version suffix`);
    if (seen.has(t.name)) problems.push(`${t.name}: duplicate name`);
    seen.add(t.name);
    for (const lang of TEMPLATE_LANGUAGES) {
      const v = t.languages?.[lang];
      if (!v) {
        problems.push(`${t.name}: missing ${lang} variant`);
        continue;
      }
      const n = placeholderCount(v.body);
      if (n !== t.params.length) problems.push(`${t.name}/${lang}: ${n} placeholders but ${t.params.length} params`);
      if (v.examples.length !== t.params.length) problems.push(`${t.name}/${lang}: examples must match params`);
      if (v.body.length > 1024) problems.push(`${t.name}/${lang}: body over 1024 chars`);
      if (/^\s*\{\{|\{\{\d+\}\}\s*$/.test(v.body)) problems.push(`${t.name}/${lang}: body may not start or end with a param`);
      if (/\{\{\d+\}\}\s*\{\{\d+\}\}/.test(v.body)) problems.push(`${t.name}/${lang}: adjacent params`);
      // Every non-authentication template must tell the member how to opt out: STOP, or the Hebrew keyword for "remove".
      if (t.category !== 'AUTHENTICATION' && !/STOP|\u05D4\u05E1\u05E8/.test(v.body)) {
        problems.push(`${t.name}/${lang}: body must tell the user how to opt out`);
      }
    }
  }
  return problems;
}

/**
 * Ordered Meta body params for a queued row. A param `key` is read from
 * payload[`${key}_${lang}`] first (localized), then payload[key]. Returns null when a
 * param is missing so the sender fails the row instead of sending a broken template.
 */
export function resolveTemplateParams(
  name: string,
  lang: string,
  payload: Record<string, unknown> | null | undefined,
): string[] | null {
  const t = getTemplate(name);
  if (!t) return null;
  const p = payload ?? {};
  const out: string[] = [];
  for (const key of t.params) {
    const v = p[`${key}_${lang}`] ?? p[key];
    if (v === undefined || v === null || String(v).trim() === '') return null;
    // Meta rejects params with newlines, tabs or 4+ consecutive spaces.
    out.push(String(v).replace(/\s+/g, ' ').trim().slice(0, 200));
  }
  return out;
}
