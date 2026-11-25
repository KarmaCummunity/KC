import 'reflect-metadata';
import {
  DonationLinkError,
  type IDonationLinksRepository,
  type IPostRepository,
  type IPublicResearchRepository,
  type ITranslationService,
  newPostInput,
} from '@kc/application';
import { type Address, createTranslationRequest, PublicResearchError, type PublicResearchSubmission } from '@kc/domain';
import { createPortTransport, createRemotePort } from '@kc/infrastructure-api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KcTestDatabase } from '../support/kcDatabase';
import { type KcGateway, startKcGateway } from '../support/kcGateway';
import type { ProviderInput } from '../../modules/translation/translationProvider';

/** The web origin the test gateway allows, as `KC_API_ALLOWED_ORIGINS` would. */
const WEB_ORIGIN = 'https://app.kc.test';
const SURVEY_SLUG = 'gateway-research-check';

/**
 * The Edge Functions this server has taken over (ADR-009 phase 8), called the
 * way the app calls them: through the remote port, the gateway, the unchanged
 * hosted adapter and the native module, down to the real KC schema.
 */
describe('Hosted functions on the KC schema', () => {
  const database = new KcTestDatabase();
  /** Stands in for the outbound reachability check: no test reaches the network. */
  const reachableHosts = new Set(['give.example.org']);
  /** Stands in for the translation provider and records what it was asked. */
  const providerCalls: ProviderInput[] = [];
  const translationProvider = {
    translate: (input: ProviderInput) => {
      providerCalls.push(input);
      return Promise.resolve({ translatedText: `EN(${input.text})`, detectedSourceLanguage: 'he', confidence: 0.5, model: 'test-provider' });
    },
  };
  let gateway: KcGateway;
  let baseUrl: string;

  beforeAll(async () => {
    gateway = await startKcGateway({
      functions: { checkReachable: (url) => Promise.resolve(reachableHosts.has(url.hostname)), translationProvider },
      config: { allowedOrigins: [WEB_ORIGIN] },
    });
    baseUrl = await gateway.listen();
    await database.admin.query(
      "insert into public.donation_link_categories (slug, icon_name, sort_order) values ('food', 'restaurant', 1) on conflict do nothing",
    );
    await database.admin.query(
      `insert into public.surveys (slug, title_he, is_active, current_version) values ($1, 'Research', true, 1)
       on conflict (slug) do update set is_active = true, current_version = 1`,
      [SURVEY_SLUG],
    );
  });

  afterAll(async () => {
    await database.admin.query('delete from kc_private.research_responses where survey_slug = $1', [SURVEY_SLUG]);
    await database.admin.query('delete from public.surveys where slug = $1', [SURVEY_SLUG]);
    await gateway?.app.close();
    await database.close();
  });

  it('a member adds and edits a donation link; the rules hold end to end', async () => {
    const alice = await database.newMember();
    const bob = await database.newMember();
    const linksOf = (userId: string) =>
      createRemotePort<IDonationLinksRepository>(createPortTransport({ baseUrl, getAccessToken: () => gateway.issuer.sign(userId) }), 'donationLinks');
    const input = { categorySlug: 'food' as const, url: 'https://give.example.org/donate', displayName: 'Food Bank' };

    const added = await linksOf(alice.userId).addViaEdgeFunction(input);
    const edited = await linksOf(alice.userId).updateViaEdgeFunction({ ...input, linkId: added.id, displayName: 'Food Bank TLV' });
    const stored = await database.admin.query<{ display_name: string; submitted_by: string; review_status: string }>(
      'select display_name, submitted_by, review_status from public.donation_links where id = $1',
      [added.id],
    );

    expect(added).toMatchObject({ categorySlug: 'food', url: 'https://give.example.org/donate', displayName: 'Food Bank' });
    expect(edited.displayName).toBe('Food Bank TLV');
    // Written by the server as the service role, attributed to the member, and sent to review.
    expect(stored.rows[0]).toEqual({ display_name: 'Food Bank TLV', submitted_by: alice.userId, review_status: 'pending' });

    // Another member may not edit it; a private address and an unreachable one are refused; so is an unknown world.
    const refusal = (attempt: Promise<unknown>) => attempt.then(() => 'accepted', (error: unknown) => (error instanceof DonationLinkError ? error.code : error));
    expect(await refusal(linksOf(bob.userId).updateViaEdgeFunction({ ...input, linkId: added.id }))).toBe('forbidden');
    expect(await refusal(linksOf(alice.userId).addViaEdgeFunction({ ...input, url: 'http://169.254.169.254/latest/meta-data/' }))).toBe('invalid_url');
    expect(await refusal(linksOf(alice.userId).addViaEdgeFunction({ ...input, url: 'https://down.example.org/' }))).toBe('unreachable');
    // A real giving world with no links category: the table's foreign key refuses it.
    expect(await refusal(linksOf(alice.userId).addViaEdgeFunction({ ...input, categorySlug: 'housing' }))).toBe('invalid_input');
    // A value that is not a giving world at all never reaches the function: the gateway's argument check stops it.
    expect(await refusal(linksOf(alice.userId).addViaEdgeFunction({ ...input, categorySlug: 'no-such-world' as never }))).toMatchObject({
      code: 'invalid_arguments',
      status: 400,
    });
  });

  describe('public research submission', () => {
    /** The survey page as a visitor's browser calls the API; `origin` is what the browser would send. */
    const researchFrom = (origin: string | null, userAgent = 'ResearchBrowser/1.0') => {
      const browserFetch: typeof fetch = (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set('user-agent', userAgent);
        if (origin) headers.set('origin', origin);
        return fetch(input, { ...init, headers });
      };
      return createRemotePort<IPublicResearchRepository>(
        createPortTransport({ baseUrl, getAccessToken: () => Promise.resolve(null), fetch: browserFetch }),
        'publicResearch',
      );
    };
    const submission = (overrides: Partial<PublicResearchSubmission> = {}): PublicResearchSubmission => ({
      slug: SURVEY_SLUG,
      version: 1,
      source: 'newsletter',
      answers: [{ questionId: 'q1', rating: 4, answerText: 'More rides, please' }],
      contactEmail: null,
      contactWindowHe: null,
      honeypot: null,
      ...overrides,
    });
    const refusal = (attempt: Promise<unknown>) =>
      attempt.then(() => 'accepted', (error: unknown) => (error instanceof PublicResearchError ? `${error.code}:${error.detail}` : error));

    it('stores a signed-out visitor\'s answers with hashed traces only, and a contact request when asked', async () => {
      const { responseId } = await researchFrom(WEB_ORIGIN).submit(submission({ contactEmail: 'visitor@kc.test', contactWindowHe: 'evening' }));

      const stored = await database.admin.query<{ source: string; ip_hash: string; user_agent_hash: string; answers: unknown }>(
        'select source, ip_hash, user_agent_hash, answers from kc_private.research_responses where id = $1',
        [responseId],
      );
      const contact = await database.admin.query<{ contact_email: string; contact_window: string }>(
        'select contact_email, contact_window from kc_private.research_contact_requests where response_id = $1',
        [responseId],
      );

      expect(stored.rows[0]).toMatchObject({ source: 'newsletter', answers: { q1: { rating: 4, answer_text: 'More rides, please' } } });
      expect(stored.rows[0]?.ip_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(stored.rows[0]?.user_agent_hash).toMatch(/^[0-9a-f]{64}$/);
      // Neither the address nor the user agent is stored in a readable form.
      expect(JSON.stringify(stored.rows[0])).not.toMatch(/127\.0\.0\.1|ResearchBrowser/);
      expect(contact.rows).toEqual([{ contact_email: 'visitor@kc.test', contact_window: 'evening' }]);
    });

    it('refuses a foreign origin, a request without an origin, and a survey that is not published', async () => {
      expect(await refusal(researchFrom('https://evil.example').submit(submission()))).toBe('network:origin_not_allowed');
      expect(await refusal(researchFrom(null).submit(submission()))).toBe('network:origin_not_allowed');
      expect(await refusal(researchFrom(WEB_ORIGIN).submit(submission({ version: 7 })))).toBe('survey_not_found:survey_not_found');
    });

    it('accepts a filled honeypot without storing anything: a bot sees success', async () => {
      const { responseId } = await researchFrom(WEB_ORIGIN).submit(submission({ honeypot: 'https://spam.example' }));

      const stored = await database.admin.query('select 1 from kc_private.research_responses where id = $1', [responseId]);

      expect(responseId).toMatch(/^[0-9a-f-]{36}$/);
      expect(stored.rowCount).toBe(0);
    });

    it('applies the database\'s per-visitor limit: the sixth answer within a minute is refused', async () => {
      // A user agent of its own does not matter: the limit counts the visitor's hashed address.
      await database.admin.query('delete from kc_private.research_responses where survey_slug = $1', [SURVEY_SLUG]);
      const research = researchFrom(WEB_ORIGIN, 'LimitBrowser/1.0');
      for (let attempt = 0; attempt < 5; attempt += 1) await research.submit(submission());

      expect(await refusal(research.submit(submission()))).toBe('rate_limited:rate_limited');
    });
  });

  describe('translation', () => {
    const portsOf = (userId: string) => {
      const transport = createPortTransport({ baseUrl, getAccessToken: () => gateway.issuer.sign(userId) });
      return {
        posts: createRemotePort<IPostRepository>(transport, 'post'),
        translation: createRemotePort<ITranslationService>(transport, 'translation'),
      };
    };
    const cachedFor = (postId: string) =>
      database.admin.query<{ field: string; translated_text: string; model: string }>(
        'select field, translated_text, model from public.content_translations where content_id = $1 order by field',
        [postId],
      );
    let address: Address;

    beforeAll(async () => {
      const city = await database.admin.query<{ city_id: string; name_he: string }>('select city_id, name_he from public.cities limit 1');
      const row = city.rows[0];
      if (!row) throw new Error('the reference seed is not loaded: no city');
      address = { city: row.city_id, cityName: row.name_he, street: 'Contract St', streetNumber: '1' };
    });

    it("translates another member's public post once, then answers every reader from the cache", async () => {
      const author = await database.newMember();
      const reader = await database.newMember();
      const post = await portsOf(author.userId).posts.create(newPostInput(author.userId, address, { title: 'ספה כחולה', description: 'כמעט חדשה' }));
      const items = [
        { contentType: 'post' as const, contentId: post.postId, field: 'title' as const },
        { contentType: 'post' as const, contentId: post.postId, field: 'description' as const },
      ];
      providerCalls.length = 0;

      const first = await portsOf(reader.userId).translation.requestTranslationsBatch('en', items);
      const again = await portsOf(reader.userId).translation.requestTranslationsBatch('en', items);
      const stored = await cachedFor(post.postId);

      expect(first.map((translation) => translation?.translatedText)).toEqual(['EN(ספה כחולה)', 'EN(כמעט חדשה)']);
      expect(again).toEqual(first);
      // The server read the text itself and asked the provider once per field, not once per reader.
      expect(providerCalls.map((call) => call.text).sort()).toEqual(['כמעט חדשה', 'ספה כחולה'].sort());
      expect(stored.rows).toEqual([
        { field: 'description', translated_text: 'EN(כמעט חדשה)', model: 'test-provider' },
        { field: 'title', translated_text: 'EN(ספה כחולה)', model: 'test-provider' },
      ]);
    });

    it('never translates a post the reader cannot see, whatever text the request carries', async () => {
      const author = await database.newMember();
      const stranger = await database.newMember();
      const hidden = await portsOf(author.userId).posts.create(newPostInput(author.userId, address, { title: 'פוסט פרטי', visibility: 'OnlyMe' }));
      const request = createTranslationRequest({ contentType: 'post', contentId: hidden.postId, field: 'title', sourceLanguage: null, targetLanguage: 'en' });
      providerCalls.length = 0;

      const single = await portsOf(stranger.userId).translation.requestTranslation(request, 'text the stranger made up');
      const batch = await portsOf(stranger.userId).translation.requestTranslationsBatch('en', [{ contentType: 'post', contentId: hidden.postId, field: 'title' }]);
      const forAuthor = await portsOf(author.userId).translation.requestTranslation(request, 'ignored');

      expect(single).toBeNull();
      expect(batch).toEqual([null]);
      // The author may translate their own post, and what is translated is the stored title.
      expect(forAuthor?.translatedText).toBe('EN(פוסט פרטי)');
      expect(providerCalls.map((call) => call.text)).toEqual(['פוסט פרטי']);
    });

    it('refuses a visitor and a target language the app does not offer', async () => {
      const member = await database.newMember();
      const call = (authorization: string | null, args: unknown[]) =>
        gateway.app.inject({
          method: 'POST',
          url: '/v1/ports/translation/requestTranslationsBatch',
          payload: { args },
          headers: authorization ? { authorization } : {},
        });
      const items = [{ contentType: 'post', contentId: '11111111-1111-4111-8111-111111111111', field: 'title' }];
      providerCalls.length = 0;

      const visitor = await call(null, ['en', items]);
      const unsupported = await call(`Bearer ${await gateway.issuer.sign(member.userId)}`, ['fr', items]);

      expect(visitor.statusCode).toBe(401);
      // The adapter shows the original text for any refusal: one null per item.
      expect(unsupported.json()).toEqual({ result: [null] });
      expect(providerCalls).toEqual([]);
    });
  });
});
