import { describe, expect, it } from 'vitest';
import { mapRpcError, type ResearchVisitor, type SubmitArgs, submitResearchResponse } from '../researchSubmission';

const ORIGIN = 'https://app.kc.test';
const VISITOR: ResearchVisitor = { origin: ORIGIN, clientAddress: '203.0.113.7', userAgent: 'UA/1' };
const BODY = { slug: 'alt-platforms', version: 2, answers: { q1: { rating: 4 } }, honeypot: '' };

/** Dependencies that record what they were asked; each can be replaced per test. */
function setup(over: { salt?: () => Promise<string>; submit?: (args: SubmitArgs) => Promise<string> } = {}) {
  const submitted: SubmitArgs[] = [];
  const reported: unknown[] = [];
  const submit = (body: unknown, visitor: ResearchVisitor = VISITOR) =>
    submitResearchResponse(body, visitor, {
      isAllowedOrigin: (origin) => origin === ORIGIN,
      getSalt: over.salt ?? (() => Promise.resolve('salt-1')),
      submit: (args) => {
        submitted.push(args);
        return over.submit ? over.submit(args) : Promise.resolve('resp-1');
      },
      report: (error) => reported.push(error),
    });
  return { submit, submitted, reported };
}

describe('submitResearchResponse', () => {
  it('refuses a foreign origin and a request without one before touching the database', async () => {
    const { submit, submitted } = setup();

    const foreign = await submit(BODY, { ...VISITOR, origin: 'https://evil.example' });
    const absent = await submit(BODY, { ...VISITOR, origin: undefined });

    expect(foreign).toEqual({ status: 403, body: { error: 'origin_not_allowed' } });
    expect(absent).toEqual({ status: 403, body: { error: 'origin_not_allowed' } });
    expect(submitted).toEqual([]);
  });

  it.each([
    ['not an object', 'not json'],
    ['empty', {}],
    ['an empty slug', { ...BODY, slug: '' }],
    ['a version that is not a number', { ...BODY, version: '2' }],
    ['answers that are a list', { ...BODY, answers: [] }],
    ['a honeypot that is not a string', { ...BODY, honeypot: null }],
  ])('rejects a body that is %s with 400 invalid_body', async (_label, bad) => {
    const { submit, submitted } = setup();

    const answer = await submit(bad);

    expect(answer).toEqual({ status: 400, body: { error: 'invalid_body' } });
    expect(submitted).toEqual([]);
  });

  it('hashes the address and the user agent with the salt, never sending them raw', async () => {
    const { submit, submitted } = setup();

    const answer = await submit({ ...BODY, source: 'newsletter', contactEmail: 'a@b.c', contactWindowHe: 'evening' });

    expect(answer).toEqual({ status: 200, body: { responseId: 'resp-1' } });
    const sent = submitted[0] as SubmitArgs;
    expect(sent.p_ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(sent.p_user_agent_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(sent.p_ip_hash).not.toBe(sent.p_user_agent_hash);
    expect(JSON.stringify(sent)).not.toContain('203.0.113.7');
    expect(JSON.stringify(sent)).not.toContain('UA/1');
    expect(sent).toMatchObject({
      p_slug: 'alt-platforms',
      p_version: 2,
      p_source: 'newsletter',
      p_answers: { q1: { rating: 4 } },
      p_honeypot: '',
      p_contact_email: 'a@b.c',
      p_contact_window_he: 'evening',
    });
  });

  it('hashes the same visitor alike under one salt and differently under another', async () => {
    const hashes: string[] = [];
    for (const salt of ['salt-1', 'salt-1', 'salt-2']) {
      const { submit, submitted } = setup({ salt: () => Promise.resolve(salt) });
      await submit(BODY);
      hashes.push((submitted[0] as SubmitArgs).p_ip_hash);
    }

    expect(hashes[0]).toBe(hashes[1]);
    expect(hashes[0]).not.toBe(hashes[2]);
  });

  it('defaults the source to direct and leaves absent contact fields null', async () => {
    const { submit, submitted } = setup();

    await submit(BODY);

    expect(submitted[0]).toMatchObject({ p_source: 'direct', p_contact_email: null, p_contact_window_he: null });
  });

  it('answers a database refusal with its mapped status and does not report it', async () => {
    const { submit, reported } = setup({ submit: () => Promise.reject(new Error('rate_limited_hour')) });

    const answer = await submit(BODY);

    expect(answer).toEqual({ status: 429, body: { error: 'rate_limited', period: 'hour' } });
    expect(reported).toEqual([]);
  });

  it('reports an unexpected database failure and answers 500 internal without its cause', async () => {
    const failure = new Error('connection reset by peer');
    const { submit, reported } = setup({ submit: () => Promise.reject(failure) });

    const answer = await submit(BODY);

    expect(answer).toEqual({ status: 500, body: { error: 'internal' } });
    expect(reported).toEqual([failure]);
  });

  it('reports a missing salt and answers 500 salt_missing without submitting', async () => {
    const { submit, submitted, reported } = setup({ salt: () => Promise.reject(new Error('down')) });

    const answer = await submit(BODY);

    expect(answer).toEqual({ status: 500, body: { error: 'salt_missing' } });
    expect(submitted).toEqual([]);
    expect(reported).toHaveLength(1);
  });
});

describe('mapRpcError', () => {
  it.each([
    ['rate_limited_minute', { status: 429, body: { error: 'rate_limited', period: 'minute' } }],
    ['rate_limited_hour', { status: 429, body: { error: 'rate_limited', period: 'hour' } }],
    ['rate_limited_day', { status: 429, body: { error: 'rate_limited', period: 'day' } }],
    ['research_circuit_open', { status: 503, body: { error: 'circuit_open' } }],
    ['survey_not_found_or_version_mismatch', { status: 400, body: { error: 'survey_not_found' } }],
    ['invalid_input', { status: 400, body: { error: 'invalid_body' } }],
    ['anything else', { status: 500, body: { error: 'internal' } }],
  ])('maps "%s" to a stable answer', (message, expected) => {
    expect(mapRpcError(message)).toEqual(expected);
  });
});
