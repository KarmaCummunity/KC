import 'reflect-metadata';
import { DonationLinkError, type IDonationLinksRepository, type IPublicResearchRepository } from '@kc/application';
import { PublicResearchError, type PublicResearchSubmission } from '@kc/domain';
import { createPortTransport, createRemotePort } from '@kc/infrastructure-api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KC_DATABASE_URL, KcTestDatabase } from '../support/kcDatabase';
import { type KcGateway, startKcGateway } from '../support/kcGateway';

/** The web origin the test gateway allows, as `KC_API_ALLOWED_ORIGINS` would. */
const WEB_ORIGIN = 'https://app.kc.test';
const SURVEY_SLUG = 'gateway-research-check';

/**
 * The Edge Functions this server has taken over (ADR-009 phase 8), called the
 * way the app calls them: through the remote port, the gateway, the unchanged
 * hosted adapter and the native module, down to the real KC schema.
 */
describe.skipIf(!KC_DATABASE_URL)('Hosted functions on the KC schema', () => {
  const database = new KcTestDatabase();
  /** Stands in for the outbound reachability check: no test reaches the network. */
  const reachableHosts = new Set(['give.example.org']);
  let gateway: KcGateway;
  let baseUrl: string;

  beforeAll(async () => {
    gateway = await startKcGateway({
      functions: { checkReachable: (url) => Promise.resolve(reachableHosts.has(url.hostname)) },
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
});
