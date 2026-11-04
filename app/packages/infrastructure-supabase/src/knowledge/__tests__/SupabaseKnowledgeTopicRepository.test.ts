// FR-KNOW-001: the Supabase adapter of the knowledge topic graph, over a recording client fake.
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../database.types';
import { SupabaseKnowledgeTopicRepository } from '../SupabaseKnowledgeTopicRepository';

type Result = { data: unknown; error: unknown };
type Call = [string, ...unknown[]];

const topicRow = {
  topic_id: 't-python',
  slug: 'python',
  parent_id: 't-programming',
  label_he: 'פייתון',
  label_en: 'Python',
  description_he: null,
  status: 'active',
  merged_into_id: null,
  sort_order: 1,
};

/** Records table and RPC calls; a query chain resolves with `queryResult` at its last method. */
function fakeClient(opts: { queryResult?: Result; rpcResult?: Result; userId?: string | null } = {}) {
  const calls: Call[] = [];
  const queryResult = opts.queryResult ?? { data: [], error: null };
  const terminal = (name: string) => (...args: unknown[]) => {
    calls.push([name, ...args]);
    return Promise.resolve(queryResult);
  };
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order', 'delete']) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  // `then` makes the builder awaitable at any point of the chain, as PostgREST's builder is.
  builder.then = (resolve: (value: Result) => unknown) => Promise.resolve(queryResult).then(resolve);
  builder.upsert = terminal('upsert');
  const client = {
    from: (table: string) => {
      calls.push(['from', table]);
      return builder;
    },
    rpc: (name: string, args: unknown) => {
      calls.push(['rpc', name, args]);
      return Promise.resolve(opts.rpcResult ?? { data: null, error: null });
    },
    auth: { getUser: async () => ({ data: { user: opts.userId === null ? null : { id: opts.userId ?? 'u1' } } }) },
  } as unknown as SupabaseClient<Database>;
  return { client, calls };
}

describe('SupabaseKnowledgeTopicRepository', () => {
  it('lists topics in sort then Hebrew-label order and maps the rows', async () => {
    const { client, calls } = fakeClient({ queryResult: { data: [topicRow], error: null } });
    const topics = await new SupabaseKnowledgeTopicRepository(client).listTopics();
    expect(topics).toEqual([
      {
        topicId: 't-python',
        slug: 'python',
        parentId: 't-programming',
        labelHe: 'פייתון',
        labelEn: 'Python',
        descriptionHe: null,
        status: 'active',
        mergedIntoId: null,
        sortOrder: 1,
      },
    ]);
    expect(calls).toEqual([
      ['from', 'knowledge_topics'],
      ['select', 'topic_id, slug, parent_id, label_he, label_en, description_he, status, merged_into_id, sort_order'],
      ['order', 'sort_order'],
      ['order', 'label_he'],
    ]);
  });

  it('resolves text through the RPC and maps the hits', async () => {
    const { client, calls } = fakeClient({
      rpcResult: { data: [{ topic_id: 'py', slug: 'python', matched_slug: 'programming', via: 'descendant' }], error: null },
    });
    const hits = await new SupabaseKnowledgeTopicRepository(client).resolveTopics('תכנות');
    expect(hits).toEqual([{ topicId: 'py', slug: 'python', matchedSlug: 'programming', via: 'descendant' }]);
    expect(calls).toEqual([['rpc', 'resolve_knowledge_topics', { p_text: 'תכנות' }]]);
  });

  it('proposes through the RPC, dropping null optionals, and maps the returned row', async () => {
    const { client, calls } = fakeClient({ rpcResult: { data: { ...topicRow, status: 'proposed' }, error: null } });
    const topic = await new SupabaseKnowledgeTopicRepository(client).proposeTopic({
      slug: 'python',
      labelHe: 'פייתון',
      labelEn: 'Python',
      parentSlug: 'programming',
      descriptionHe: null,
    });
    expect(topic.status).toBe('proposed');
    expect(calls[0]).toEqual([
      'rpc',
      'propose_knowledge_topic',
      { p_slug: 'python', p_label_he: 'פייתון', p_label_en: 'Python', p_parent_slug: 'programming', p_description_he: undefined },
    ]);
  });

  it('turns an RPC error name into a coded KnowledgeTopicError', async () => {
    const { client } = fakeClient({ rpcResult: { data: null, error: { message: 'knowledge_topic_slug_taken' } } });
    await expect(
      new SupabaseKnowledgeTopicRepository(client).proposeTopic({ slug: 'python', labelHe: 'x', labelEn: 'x' }),
    ).rejects.toMatchObject({ name: 'KnowledgeTopicError', code: 'slug_taken' });
  });

  it('reviews through the RPC with the action and optional fields', async () => {
    const { client, calls } = fakeClient({ rpcResult: { data: { ...topicRow, status: 'merged', merged_into_id: 't2' }, error: null } });
    const topic = await new SupabaseKnowledgeTopicRepository(client).reviewTopic({
      topicId: 't-python',
      action: 'merge',
      mergeIntoId: 't2',
    });
    expect(topic.mergedIntoId).toBe('t2');
    expect(calls[0]).toEqual([
      'rpc',
      'review_knowledge_topic',
      { p_topic_id: 't-python', p_action: 'merge', p_merge_into_id: 't2', p_label_he: undefined, p_label_en: undefined },
    ]);
  });

  it('follows with an idempotent upsert of the member’s own row and unfollows with a delete', async () => {
    const { client, calls } = fakeClient({ userId: 'u1', queryResult: { data: null, error: null } });
    const repo = new SupabaseKnowledgeTopicRepository(client);
    await repo.setTopicFollowed('t1', true);
    expect(calls).toEqual([
      ['from', 'knowledge_topic_follows'],
      ['upsert', { user_id: 'u1', topic_id: 't1' }, { onConflict: 'user_id,topic_id', ignoreDuplicates: true }],
    ]);
    calls.length = 0;
    await repo.setTopicFollowed('t1', false);
    expect(calls).toEqual([
      ['from', 'knowledge_topic_follows'],
      ['delete'],
      ['eq', 'user_id', 'u1'],
      ['eq', 'topic_id', 't1'],
    ]);
  });

  it('refuses to follow without a session', async () => {
    const { client } = fakeClient({ userId: null });
    await expect(new SupabaseKnowledgeTopicRepository(client).setTopicFollowed('t1', true)).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });

  it('lists the followed topic ids', async () => {
    const { client } = fakeClient({ queryResult: { data: [{ topic_id: 'a' }, { topic_id: 'b' }], error: null } });
    await expect(new SupabaseKnowledgeTopicRepository(client).listFollowedTopicIds()).resolves.toEqual(['a', 'b']);
  });
});
