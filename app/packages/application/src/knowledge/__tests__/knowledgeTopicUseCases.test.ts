// FR-KNOW-001: the knowledge topic use cases over the port double.
import { describe, expect, it } from 'vitest';
import { ValidationError } from '@kc/domain';
import { FollowKnowledgeTopicUseCase } from '../FollowKnowledgeTopicUseCase';
import { ListKnowledgeTopicsUseCase } from '../ListKnowledgeTopicsUseCase';
import { ProposeKnowledgeTopicUseCase } from '../ProposeKnowledgeTopicUseCase';
import { ResolveKnowledgeTopicsUseCase } from '../ResolveKnowledgeTopicsUseCase';
import { ReviewKnowledgeTopicUseCase } from '../ReviewKnowledgeTopicUseCase';
import { KnowledgeTopicError, isKnowledgeTopicError, knowledgeTopicErrorFromDb } from '../errors';
import { FakeKnowledgeTopicRepository, makeTopic } from './fakeKnowledgeTopicRepository';

describe('ListKnowledgeTopicsUseCase', () => {
  it('returns the tree without merged topics', async () => {
    const repo = new FakeKnowledgeTopicRepository();
    repo.topics = [
      makeTopic({ topicId: 'p', slug: 'programming', parentId: null, sortOrder: 1 }),
      makeTopic({ topicId: 'py', slug: 'python', parentId: 'p' }),
      makeTopic({ topicId: 'old', slug: 'old', parentId: 'p', status: 'merged', mergedIntoId: 'py' }),
    ];
    const tree = await new ListKnowledgeTopicsUseCase(repo).execute();
    expect(tree).toHaveLength(1);
    expect(tree[0]?.children.map((node) => node.slug)).toEqual(['python']);
  });
});

describe('ResolveKnowledgeTopicsUseCase', () => {
  it('skips the database for text that normalizes to nothing', async () => {
    const repo = new FakeKnowledgeTopicRepository();
    await expect(new ResolveKnowledgeTopicsUseCase(repo).execute('  ?!  ')).resolves.toEqual([]);
    expect(repo.resolveCalls).toEqual([]);
  });

  it('forwards trimmed text otherwise', async () => {
    const repo = new FakeKnowledgeTopicRepository();
    repo.matches = [{ topicId: 'py', slug: 'python', matchedSlug: 'python', via: 'self' }];
    await expect(new ResolveKnowledgeTopicsUseCase(repo).execute('  פיתון ')).resolves.toHaveLength(1);
    expect(repo.resolveCalls).toEqual(['פיתון']);
  });
});

describe('ProposeKnowledgeTopicUseCase', () => {
  it('validates with the domain rules and forwards the trimmed proposal', async () => {
    const repo = new FakeKnowledgeTopicRepository();
    const topic = await new ProposeKnowledgeTopicUseCase(repo).execute({
      slug: ' Rust ',
      labelHe: ' ראסט ',
      labelEn: 'Rust',
      parentSlug: 'programming',
    });
    expect(topic.status).toBe('proposed');
    expect(repo.lastProposal).toEqual({
      slug: 'rust',
      labelHe: 'ראסט',
      labelEn: 'Rust',
      parentSlug: 'programming',
      descriptionHe: null,
    });
  });

  it('rejects a malformed slug before touching the repository', async () => {
    const repo = new FakeKnowledgeTopicRepository();
    await expect(
      new ProposeKnowledgeTopicUseCase(repo).execute({ slug: 'Not A Slug', labelHe: 'x', labelEn: 'x' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(repo.lastProposal).toBeNull();
  });
});

describe('ReviewKnowledgeTopicUseCase', () => {
  it('approves', async () => {
    const repo = new FakeKnowledgeTopicRepository();
    await new ReviewKnowledgeTopicUseCase(repo).execute({ topicId: 't1', action: 'approve' });
    expect(repo.lastReview).toEqual({ topicId: 't1', action: 'approve', mergeIntoId: null, labelHe: null, labelEn: null });
  });

  it('requires a different target for a merge', async () => {
    const repo = new FakeKnowledgeTopicRepository();
    const uc = new ReviewKnowledgeTopicUseCase(repo);
    await expect(uc.execute({ topicId: 't1', action: 'merge' })).rejects.toMatchObject({ code: 'merge_target_invalid' });
    await expect(uc.execute({ topicId: 't1', action: 'merge', mergeIntoId: 't1' })).rejects.toMatchObject({
      code: 'merge_target_invalid',
    });
    const merged = await uc.execute({ topicId: 't1', action: 'merge', mergeIntoId: 't2' });
    expect(merged.status).toBe('merged');
    expect(repo.lastReview?.mergeIntoId).toBe('t2');
  });

  it('requires at least one label for a rename and trims them', async () => {
    const repo = new FakeKnowledgeTopicRepository();
    const uc = new ReviewKnowledgeTopicUseCase(repo);
    await expect(uc.execute({ topicId: 't1', action: 'rename', labelHe: '  ' })).rejects.toMatchObject({
      code: 'action_invalid',
    });
    await uc.execute({ topicId: 't1', action: 'rename', labelHe: ' ראסט ' });
    expect(repo.lastReview).toMatchObject({ action: 'rename', labelHe: 'ראסט', labelEn: null });
  });

  it('refuses an unknown action', async () => {
    const repo = new FakeKnowledgeTopicRepository();
    await expect(
      new ReviewKnowledgeTopicUseCase(repo).execute({
        topicId: 't1',
        action: 'dance' as unknown as 'approve',
      }),
    ).rejects.toMatchObject({ code: 'action_invalid' });
  });
});

describe('FollowKnowledgeTopicUseCase', () => {
  it('forwards follow and unfollow', async () => {
    const repo = new FakeKnowledgeTopicRepository();
    await new FollowKnowledgeTopicUseCase(repo).execute({ topicId: 't1', followed: false });
    expect(repo.lastFollow).toEqual({ topicId: 't1', followed: false });
  });

  it('refuses an empty topic id', async () => {
    const repo = new FakeKnowledgeTopicRepository();
    await expect(new FollowKnowledgeTopicUseCase(repo).execute({ topicId: '', followed: true })).rejects.toBeInstanceOf(
      KnowledgeTopicError,
    );
  });
});

describe('knowledgeTopicErrorFromDb', () => {
  it('maps the RPC error names of migration 0570 to codes', () => {
    expect(knowledgeTopicErrorFromDb({ message: 'knowledge_topic_slug_taken' }).code).toBe('slug_taken');
    expect(knowledgeTopicErrorFromDb({ message: 'forbidden' }).code).toBe('forbidden');
    expect(knowledgeTopicErrorFromDb({ message: 'auth_required' }).code).toBe('unauthorized');
  });

  it('classifies transport failures and keeps the cause', () => {
    const cause = { message: 'TypeError: Failed to fetch' };
    const err = knowledgeTopicErrorFromDb(cause);
    expect(err.code).toBe('network');
    expect(err.cause).toBe(cause);
    expect(knowledgeTopicErrorFromDb(null).code).toBe('unknown');
    expect(isKnowledgeTopicError(err)).toBe(true);
    expect(isKnowledgeTopicError(new Error('x'))).toBe(false);
  });
});
