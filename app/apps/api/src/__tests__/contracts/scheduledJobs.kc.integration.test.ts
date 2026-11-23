import 'reflect-metadata';
import { type IPostRepository, newPostInput } from '@kc/application';
import type { Address } from '@kc/domain';
import { createPortTransport, createRemotePort } from '@kc/infrastructure-api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KC_DATABASE_URL, KcTestDatabase } from '../support/kcDatabase';
import { type KcGateway, startKcGateway } from '../support/kcGateway';

const JOBS_TOKEN = 'integration-jobs-token-0123456789abcdef';

/**
 * The scheduled jobs on the real KC schema, started the way a scheduler
 * starts them: `POST /v1/jobs/<name>` with the jobs token.
 */
describe.skipIf(!KC_DATABASE_URL)('Scheduled jobs on the KC schema', () => {
  const database = new KcTestDatabase();
  let gateway: KcGateway;
  let baseUrl: string;

  const runJob = (name: string, payload: Record<string, unknown> = {}, token: string | null = JOBS_TOKEN) =>
    gateway.app.inject({ method: 'POST', url: `/v1/jobs/${name}`, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });
  /** The research salt, read as the service role (the only role that may). */
  const currentSalt = async () => {
    const client = await database.admin.connect();
    try {
      await client.query("begin; set local role service_role; set local search_path = 'public, extensions'");
      const salt = (await client.query<{ salt: string }>('select public.get_research_salt() as salt')).rows[0]?.salt;
      await client.query('rollback');
      return salt;
    } finally {
      client.release();
    }
  };

  beforeAll(async () => {
    gateway = await startKcGateway({ config: { jobsToken: JOBS_TOKEN } });
    baseUrl = await gateway.listen();
  });

  afterAll(async () => {
    await gateway?.app.close();
    await database.close();
  });

  it('rotates the research salt: the value hashes are made with is replaced', async () => {
    const before = await currentSalt();

    const response = await runJob('rotate-research-salt');
    const after = await currentSalt();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true });
    expect(Number.isNaN(Date.parse(response.json().rotated_at))).toBe(false);
    expect(after).toMatch(/^[0-9a-f]{64}$/);
    expect(after).not.toBe(before);
  });

  it('gives a new post its embedding: the post\'s outbox event becomes a job, and the job a stored vector', async () => {
    const author = await database.newMember();
    const city = await database.admin.query<{ city_id: string; name_he: string }>('select city_id, name_he from public.cities limit 1');
    const address: Address = { city: city.rows[0]?.city_id ?? '', cityName: city.rows[0]?.name_he ?? '', street: 'Contract St', streetNumber: '1' };
    const posts = createRemotePort<IPostRepository>(createPortTransport({ baseUrl, getAccessToken: () => gateway.issuer.sign(author.userId) }), 'post');
    const post = await posts.create(newPostInput(author.userId, address, { title: 'A sofa for the embedding job' }));

    // Other suites leave jobs behind; run until this post's turn has come.
    let processed = 0;
    for (let round = 0; round < 10; round += 1) {
      const response = await runJob('embed-worker', { limit: 50 });
      expect(response.statusCode).toBe(200);
      processed += response.json().processed as number;
      if ((response.json().processed as number) === 0) break;
    }
    const stored = await database.admin.query<{ dims: number }>('select extensions.vector_dims(embedding) as dims from public.post_embeddings where post_id = $1', [post.postId]);

    expect(processed).toBeGreaterThan(0);
    expect(stored.rows).toEqual([{ dims: 1536 }]);
  });

  it('runs the charge of due standing orders and the match re-rank, which have nothing to do here', async () => {
    const charge = await runJob('subscriptions-charger');
    const rerank = await runJob('match-rerank');

    expect(charge.json()).toEqual({ ok: true, opened: 0, submitted: 0, failed: 0 });
    // No model key is configured in tests: the re-rank must not touch the database or the network.
    expect(rerank.json()).toEqual({ ok: true, skipped: 'no_gemini_key', scored: 0 });
  });

  it('starts nothing for a caller without the jobs token', async () => {
    const before = await currentSalt();

    const missing = await runJob('rotate-research-salt', {}, null);
    const wrong = await runJob('rotate-research-salt', {}, 'not-the-jobs-token-0123456789abcdef');

    expect([missing.statusCode, wrong.statusCode]).toEqual([401, 401]);
    expect(await currentSalt()).toBe(before);
  });
});
