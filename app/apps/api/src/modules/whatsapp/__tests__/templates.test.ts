import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { getTemplate, placeholderCount, resolveTemplateParams, TEMPLATE, TEMPLATES, validateRegistry } from '../templates';

it('registry passes Meta-style static validation', () => {
  expect(validateRegistry()).toEqual([]);
});

it('registry covers the #936 templates in he and en', () => {
  for (const name of Object.values(TEMPLATE)) {
    const t = getTemplate(name);
    expect(t, `${name} missing`).toBeTruthy();
    expect(t?.languages.he.body && t.languages.en.body).toBeTruthy();
  }
});

it('validateRegistry catches broken templates', () => {
  const bad = validateRegistry([{
    name: 'Bad-Name',
    category: 'UTILITY',
    purpose: 'x',
    params: ['a'],
    languages: {
      he: { body: '{{1}}', examples: [] },
      en: { body: 'no params, no opt out', examples: ['a'] },
    },
  }]);
  expect(bad.some((p) => p.includes('lowercase'))).toBeTruthy();
  expect(bad.some((p) => p.includes('_vN'))).toBeTruthy();
  expect(bad.some((p) => p.includes('start or end'))).toBeTruthy();
  expect(bad.some((p) => p.includes('0 placeholders'))).toBeTruthy();
  expect(bad.some((p) => p.includes('opt out'))).toBeTruthy();
});

it('resolveTemplateParams prefers localized keys and refuses missing params', () => {
  const payload = { world: 'items', world_label_he: 'HE-items', world_label_en: 'Items' };
  expect(resolveTemplateParams(TEMPLATE.matchFound, 'en', payload)).toEqual(['Items']);
  expect(resolveTemplateParams(TEMPLATE.matchFound, 'he', payload)).toEqual(['HE-items']);
  expect(resolveTemplateParams(TEMPLATE.confirmHandoff, 'en', { partner_name: 'Dana' })).toEqual(null);
  expect(resolveTemplateParams(TEMPLATE.optInConfirm, 'he', null)).toEqual([]);
  expect(resolveTemplateParams('intake_confirm_v1', 'he', {})).toEqual(null);
  expect(resolveTemplateParams(TEMPLATE.reminder, 'en', { listing_title: 'a\n\tb    c' })).toEqual(['a b c']);
});

it('placeholderCount counts the numbered placeholders of a body', () => {
  expect(placeholderCount('a {{1}} b {{2}}')).toEqual(2);
});

// The seed is in the frozen baseline or, for a later change, in a forward migration; the
// registry must appear in the migrations as a whole.
const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../../../../supabase/migrations', import.meta.url));
const EDGE_REGISTRY = fileURLToPath(new URL('../../../../../../../supabase/functions/_shared/whatsapp/templates.json', import.meta.url));

function migrationsSql(): string {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => readFileSync(join(MIGRATIONS_DIR, name), 'utf8'))
    .join('\n');
}

it('the registry is the same one the Edge Function sends from, while that function exists', () => {
  expect(TEMPLATES).toEqual((JSON.parse(readFileSync(EDGE_REGISTRY, 'utf8')) as { templates: unknown }).templates);
});

it('the template seed in the migrations mirrors templates.json (he + en bodies and params)', () => {
  const sql = migrationsSql();
  for (const template of TEMPLATES) {
    for (const lang of ['he', 'en'] as const) {
      const body = template.languages[lang].body.replaceAll("'", "''");
      const row = `('${template.name}', '${lang}', '${template.category.toLowerCase()}', '${body}', '${JSON.stringify(template.params)}', `;
      expect(sql.includes(row), `the seed is out of sync for ${template.name}/${lang}`).toBe(true);
    }
  }
});
