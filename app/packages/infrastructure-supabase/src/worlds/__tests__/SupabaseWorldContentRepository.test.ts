import { describe, expect, it } from 'vitest';
import { BackendUnavailableError } from '@kc/domain';
import { callsTo, createFakeClient } from '../../__tests__/fakeBaselineClient';
import { fail, ok } from '../../posts/__tests__/cardFixtures';
import { SupabaseWorldContentRepository } from '../SupabaseWorldContentRepository';
import { EXTERNAL_BODY_COLUMNS, WORLD_LINK_COLUMNS, WORLD_TOPIC_COLUMNS } from '../mapWorldContent';

const LINK = {
  id: 'l1', from_world_slug: 'animals', to_world_slug: 'food', link_slug: 'pet_food',
  label_he: 'מזון לחיות', label_en: 'Pet food', description: null,
};
const BODY = {
  id: 'b1', slug: 'spca_israel', world_slug: 'animals', label_he: 'צער בעלי חיים', label_en: 'SPCA Israel',
  body_type: 'ngo', contact_url: null,
};
const TOPIC = {
  id: 't1', slug: 'pet-care', parent_id: null, label_he: 'טיפול בחיות', label_en: 'Pet care',
  description_he: null, status: 'active', merged_into_id: null, sort_order: 3,
};

describe('SupabaseWorldContentRepository', () => {
  it('reads the live links, organizations and topics of the asked world and maps them', async () => {
    const { client, calls } = createFakeClient({
      tables: { world_links: ok([LINK]), external_bodies: ok([BODY]), knowledge_topics: ok([TOPIC]) },
    });
    const content = await new SupabaseWorldContentRepository(client).getWorldContent('animals');

    expect(content).toEqual({
      worldSlug: 'animals',
      links: [{
        linkId: 'l1', fromWorldSlug: 'animals', toWorldSlug: 'food', linkSlug: 'pet_food',
        labelHe: 'מזון לחיות', labelEn: 'Pet food', description: null,
      }],
      externalBodies: [{
        bodyId: 'b1', slug: 'spca_israel', worldSlug: 'animals', labelHe: 'צער בעלי חיים', labelEn: 'SPCA Israel',
        bodyType: 'ngo', contactUrl: null,
      }],
      topics: [{
        topicId: 't1', slug: 'pet-care', parentId: null, labelHe: 'טיפול בחיות', labelEn: 'Pet care',
        descriptionHe: null, status: 'active', mergedIntoId: null, sortOrder: 3,
      }],
    });

    const links = callsTo(calls, 'world_links')[0];
    expect(links?.filters).toContainEqual(['eq', 'from_world_slug', 'animals']);
    expect(links?.filters).toContainEqual(['eq', 'is_active', true]);
    expect(callsTo(calls, 'external_bodies')[0]?.filters).toContainEqual(['eq', 'world_slug', 'animals']);
    const topics = callsTo(calls, 'knowledge_topics')[0];
    expect(topics?.filters).toContainEqual(['eq', 'world_slug', 'animals']);
    expect(topics?.filters).toContainEqual(['eq', 'status', 'active']);
  });

  it('names its columns on every table, never a star', async () => {
    const { client, calls } = createFakeClient();
    await new SupabaseWorldContentRepository(client).getWorldContent('food');
    expect(callsTo(calls, 'world_links')[0]?.columns).toBe(WORLD_LINK_COLUMNS);
    expect(callsTo(calls, 'external_bodies')[0]?.columns).toBe(EXTERNAL_BODY_COLUMNS);
    expect(callsTo(calls, 'knowledge_topics')[0]?.columns).toBe(WORLD_TOPIC_COLUMNS);
  });

  it('returns empty lists for a world with nothing curated', async () => {
    const { client } = createFakeClient({
      tables: { world_links: ok([]), external_bodies: ok(null), knowledge_topics: ok([]) },
    });
    await expect(new SupabaseWorldContentRepository(client).getWorldContent('items')).resolves.toEqual({
      worldSlug: 'items', links: [], externalBodies: [], topics: [],
    });
  });

  it('fails as a whole when one read fails, and reports a missing table as backend unavailable', async () => {
    const timedOut = createFakeClient({ tables: { external_bodies: fail('57014', 'canceling statement due to statement timeout') } });
    await expect(new SupabaseWorldContentRepository(timedOut.client).getWorldContent('animals')).rejects.toThrow('statement timeout');

    const missing = createFakeClient({ tables: { knowledge_topics: fail('PGRST205', "Could not find the table 'public.knowledge_topics' in the schema cache") } });
    await expect(new SupabaseWorldContentRepository(missing.client).getWorldContent('animals')).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});
