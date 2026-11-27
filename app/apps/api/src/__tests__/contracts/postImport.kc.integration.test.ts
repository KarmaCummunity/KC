import 'reflect-metadata';
import type { IPostExtractionService } from '@kc/application';
import { createPortTransport, createRemotePort } from '@kc/infrastructure-api';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ExtractionProviderInput } from '../../modules/postImport/extractionProvider';
import { KcTestDatabase } from '../support/kcDatabase';
import { type KcGateway, startKcGateway } from '../support/kcGateway';

const FLAG_KEY = 'external_post_import_enabled';
const SHARED_TEXT = 'מוסר ספה תלת מושבית בתירוש, התקשרו 050-1234567';

/**
 * The external post import (FR-IMPORT-001..009) the way the app calls it:
 * remote port, gateway, the unchanged hosted adapter, the native module, and
 * the real KC schema with its place catalog. Only the model is a stand-in.
 */
describe('Post import on the KC schema', () => {
  const database = new KcTestDatabase();
  /** What the stand-in model was sent; it answers a furniture offer in the city of Tirosh. */
  const providerInputs: ExtractionProviderInput[] = [];
  const postExtractionProvider = {
    extract: (input: ExtractionProviderInput) => {
      providerInputs.push(input);
      return Promise.resolve({
        model: 'test-model',
        raw: {
          is_post: true,
          reject_reason: null,
          direction: 'offer',
          world_slug: 'items',
          subcategory: null,
          title: 'ספה תלת מושבית',
          description: 'במצב טוב',
          place: { city_text: 'תירוש' },
          time: { kind: 'none' },
          ride: null,
          details: {},
          language: 'he',
          confidence: { overall: 0.95, per_field: { direction: 0.95, world: 0.95, title: 0.95, city: 0.95 } },
        },
      });
    },
  };
  let gateway: KcGateway;
  let baseUrl: string;

  const importsOf = (userId: string) =>
    createRemotePort<IPostExtractionService>(createPortTransport({ baseUrl, getAccessToken: () => gateway.issuer.sign(userId) }), 'postExtraction');
  const setFlag = (enabled: boolean) =>
    database.admin.query('insert into public.app_flags (key, enabled) values ($1, $2) on conflict (key) do update set enabled = excluded.enabled', [FLAG_KEY, enabled]);
  /** A member whose account is old enough to import (the limit is 24 hours). */
  const establishedMember = async () => {
    const member = await database.newMember();
    await database.admin.query("update public.users set created_at = now() - interval '3 days' where id = $1", [member.userId]);
    return member;
  };
  const recordsOf = (userId: string) =>
    database.admin.query<{ routing: string; reason: string; provider_called: boolean; model: string | null; text_fingerprint: string; extraction: unknown }>(
      'select routing, reason, provider_called, model, text_fingerprint, extraction from public.external_post_imports where user_id = $1 order by created_at',
      [userId],
    );

  beforeAll(async () => {
    gateway = await startKcGateway({ functions: { postExtractionProvider } });
    baseUrl = await gateway.listen();
  });

  beforeEach(async () => {
    providerInputs.length = 0;
    // Each case starts from an empty day cache, so the first import of a text always reaches the model.
    await database.admin.query('delete from public.post_extraction_cache');
    await setFlag(true);
  });

  afterAll(async () => {
    await database.admin.query('delete from public.app_flags where key = $1', [FLAG_KEY]);
    await gateway?.app.close();
    await database.close();
  });

  it('turns a shared message into a draft: scrubbed for the model, the city found in the catalog, the attempt recorded', async () => {
    const member = await establishedMember();

    const draft = await importsOf(member.userId).extract({ text: SHARED_TEXT, channel: 'share', sourcePlatform: 'whatsapp' });
    const records = await recordsOf(member.userId);

    // The phone number never reached the model.
    expect(providerInputs).toHaveLength(1);
    expect(providerInputs[0]?.text).not.toContain('050');
    expect(providerInputs[0]?.lists.worlds).toContain('items');
    // An auto-picked city always needs the member's look, so the draft is on the confirm route.
    expect(draft).toMatchObject({ routing: 'confirm', reason: 'ok', duplicatePostId: null });
    expect(draft?.city?.picked).toMatchObject({ placeId: '10', nameHe: 'תירוש' });
    expect(records.rows).toHaveLength(1);
    expect(records.rows[0]).toMatchObject({ routing: 'confirm', reason: 'ok', provider_called: true, model: 'test-model' });
    expect(records.rows[0]?.text_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(records.rows[0])).not.toContain('050-1234567');
  });

  it('answers the same text from the day cache without a second model call', async () => {
    const member = await establishedMember();
    const imports = importsOf(member.userId);

    const first = await imports.extract({ text: SHARED_TEXT, channel: 'paste', sourcePlatform: 'unknown' });
    const second = await imports.extract({ text: `${SHARED_TEXT}!!`, channel: 'paste', sourcePlatform: 'unknown' });
    const records = await recordsOf(member.userId);

    expect(providerInputs).toHaveLength(1);
    expect(second?.extraction?.title).toBe(first?.extraction?.title);
    expect(records.rows.map((row) => [row.provider_called, row.model])).toEqual([
      [true, 'test-model'],
      [false, 'cache'],
    ]);
  });

  it('stops at the sixth import within an hour: the limit counts what is in the database', async () => {
    const member = await establishedMember();
    const imports = importsOf(member.userId);
    const attempt = () => imports.extract({ text: SHARED_TEXT, channel: 'paste', sourcePlatform: 'unknown' });

    for (let count = 0; count < 5; count += 1) await attempt();
    const sixth = await attempt();

    expect(sixth).toMatchObject({ routing: 'manual', reason: 'rate_limited' });
    expect((await recordsOf(member.userId)).rows).toHaveLength(5);
  });

  it('gives a new account and a switched-off feature the manual route, with no model call and no record', async () => {
    const newcomer = await database.newMember();
    const member = await establishedMember();

    const tooNew = await importsOf(newcomer.userId).extract({ text: SHARED_TEXT, channel: 'paste', sourcePlatform: 'unknown' });
    await setFlag(false);
    const disabled = await importsOf(member.userId).extract({ text: SHARED_TEXT, channel: 'paste', sourcePlatform: 'unknown' });

    expect(tooNew).toMatchObject({ routing: 'manual', reason: 'account_too_new' });
    expect(disabled).toMatchObject({ routing: 'manual', reason: 'disabled' });
    expect(providerInputs).toEqual([]);
    expect([...(await recordsOf(newcomer.userId)).rows, ...(await recordsOf(member.userId)).rows]).toEqual([]);
  });

  it('refuses a visitor: the import is for members', async () => {
    const response = await gateway.app.inject({
      method: 'POST',
      url: '/v1/ports/postExtraction/extract',
      payload: { args: [{ text: SHARED_TEXT, channel: 'paste', sourcePlatform: 'unknown' }] },
    });

    expect(response.statusCode).toBe(401);
    expect(providerInputs).toEqual([]);
  });
});
