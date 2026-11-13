import { assert, assertEquals } from 'jsr:@std/assert@1';
import {
  getTemplate,
  placeholderCount,
  resolveTemplateParams,
  TEMPLATE,
  TEMPLATES,
  validateRegistry,
} from './templates.ts';

Deno.test('registry passes Meta-style static validation', () => {
  assertEquals(validateRegistry(), []);
});

Deno.test('registry covers the #936 templates in he and en', () => {
  for (const name of Object.values(TEMPLATE)) {
    const t = getTemplate(name);
    assert(t, `${name} missing`);
    assert(t.languages.he.body && t.languages.en.body);
  }
});

Deno.test('validateRegistry catches broken templates', () => {
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
  assert(bad.some((p) => p.includes('lowercase')));
  assert(bad.some((p) => p.includes('_vN')));
  assert(bad.some((p) => p.includes('start or end')));
  assert(bad.some((p) => p.includes('0 placeholders')));
  assert(bad.some((p) => p.includes('opt out')));
});

Deno.test('resolveTemplateParams prefers localized keys and refuses missing params', () => {
  const payload = { world: 'items', world_label_he: 'HE-items', world_label_en: 'Items' };
  assertEquals(resolveTemplateParams(TEMPLATE.matchFound, 'en', payload), ['Items']);
  assertEquals(resolveTemplateParams(TEMPLATE.matchFound, 'he', payload), ['HE-items']);
  assertEquals(resolveTemplateParams(TEMPLATE.confirmHandoff, 'en', { partner_name: 'Dana' }), null);
  assertEquals(resolveTemplateParams(TEMPLATE.optInConfirm, 'he', null), []);
  assertEquals(resolveTemplateParams('intake_confirm_v1', 'he', {}), null);
  assertEquals(resolveTemplateParams(TEMPLATE.reminder, 'en', { listing_title: 'a\n\tb    c' }), ['a b c']);
});

Deno.test('placeholderCount counts the numbered placeholders of a body', () => {
  assertEquals(placeholderCount('a {{1}} b {{2}}'), 2);
});

// The seed migration is `next-NN_…` on a branch and `00NN_…` once merged, so match it by slug.
const TEMPLATE_SEED_SLUG = '_whatsapp_channel_schema.sql';

async function templateSeedSql(): Promise<{ name: string; sql: string }> {
  const dir = new URL('../../../migrations/', import.meta.url);
  const names: string[] = [];
  for await (const e of Deno.readDir(dir)) {
    if (e.isFile && e.name.endsWith(TEMPLATE_SEED_SLUG)) names.push(e.name);
  }
  assertEquals(names.length, 1, `exactly one migration ends with ${TEMPLATE_SEED_SLUG}: ${names.join(', ')}`);
  return { name: names[0], sql: await Deno.readTextFile(new URL(names[0], dir)) };
}

Deno.test('the template seed migration mirrors templates.json (he + en bodies and params)', async () => {
  const { name, sql } = await templateSeedSql();
  for (const t of TEMPLATES) {
    for (const lang of ['he', 'en'] as const) {
      const body = t.languages[lang].body.replaceAll("'", "''");
      const row = `('${t.name}', '${lang}', '${t.category.toLowerCase()}', '${body}', '${JSON.stringify(t.params)}', `;
      assert(sql.includes(row), `${name} seed out of sync for ${t.name}/${lang}; regenerate with scripts/whatsapp-templates.mjs sql`);
    }
  }
  const seeded = sql.match(/^\s*\('[a-z0-9_]+_v\d+', '(he|en)', /gm) ?? [];
  assertEquals(seeded.length, TEMPLATES.length * 2, 'the seed has a row per template and language, and no others');
});
