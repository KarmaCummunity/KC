import { assert, assertEquals } from 'jsr:@std/assert@1';
import { validateExtraction } from './domain/validateExtraction.ts';
import { CONTRACT_KEYS, EXTRACTION_RESPONSE_SCHEMA } from './schema.ts';

Deno.test('the response schema declares exactly the contract keys the validator reads', () => {
  assertEquals(Object.keys(EXTRACTION_RESPONSE_SCHEMA.properties).sort(), [...CONTRACT_KEYS].sort());
});

Deno.test('is_post is the only required key, as in validateExtraction', () => {
  assertEquals(EXTRACTION_RESPONSE_SCHEMA.required, ['is_post']);
});

Deno.test('a minimal object the schema allows passes the validator', () => {
  const lists = { worlds: [], subcategories: {}, detailKeys: {} };
  assert(!validateExtraction({ is_post: false }, lists).isPost);
});
