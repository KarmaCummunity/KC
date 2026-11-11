import { assert, assertEquals } from 'jsr:@std/assert@1';
import {
  getTemplate,
  placeholderCount,
  resolveTemplateParams,
  TEMPLATE,
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
