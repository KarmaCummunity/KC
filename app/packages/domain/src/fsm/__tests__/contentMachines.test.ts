import { describe, expect, it } from 'vitest';
import { canTransition, isTerminal } from '../machine';
import { embeddingJobMachine } from '../machines/embeddingJob';
import { knowledgeTopicMachine } from '../machines/knowledgeTopic';
import { postCommentMachine } from '../machines/postComment';

describe('post comment machine', () => {
  it('deletes an active comment; only staff bring one back', () => {
    for (const role of ['author', 'post_owner', 'admin']) {
      expect(canTransition(postCommentMachine, 'active', 'deleted', role)).toEqual({ ok: true, changed: true });
    }
    expect(canTransition(postCommentMachine, 'active', 'deleted', 'stranger')).toEqual({
      ok: false,
      code: 'forbidden_role',
    });
    expect(canTransition(postCommentMachine, 'deleted', 'active', 'admin')).toEqual({ ok: true, changed: true });
    for (const role of ['author', 'post_owner']) {
      expect(canTransition(postCommentMachine, 'deleted', 'active', role)).toEqual({ ok: false, code: 'forbidden_role' });
    }
    expect(isTerminal(postCommentMachine, 'deleted')).toBe(false);
  });

  it('treats an edit as a same-status write', () => {
    expect(canTransition(postCommentMachine, 'active', 'active')).toEqual({ ok: true, changed: false });
  });
});

describe('knowledge topic machine (FR-KNOW-001 AC5)', () => {
  it('approves a suggested topic and merges a suggested or an active one', () => {
    expect(canTransition(knowledgeTopicMachine, 'proposed', 'active')).toEqual({ ok: true, changed: true });
    expect(canTransition(knowledgeTopicMachine, 'proposed', 'merged')).toEqual({ ok: true, changed: true });
    expect(canTransition(knowledgeTopicMachine, 'active', 'merged')).toEqual({ ok: true, changed: true });
  });

  it('never revives a merged topic or sends an active one back to a suggestion', () => {
    expect(isTerminal(knowledgeTopicMachine, 'merged')).toBe(true);
    expect(canTransition(knowledgeTopicMachine, 'merged', 'active')).toEqual({ ok: false, code: 'illegal_transition' });
    expect(canTransition(knowledgeTopicMachine, 'active', 'proposed')).toEqual({ ok: false, code: 'illegal_transition' });
  });
});

describe('embedding job machine', () => {
  it('is claimed, then stored or failed', () => {
    expect(canTransition(embeddingJobMachine, 'pending', 'processing')).toEqual({ ok: true, changed: true });
    expect(canTransition(embeddingJobMachine, 'processing', 'done')).toEqual({ ok: true, changed: true });
    expect(canTransition(embeddingJobMachine, 'processing', 'failed')).toEqual({ ok: true, changed: true });
  });

  it('goes back to waiting when the post asks for a fresh embedding', () => {
    for (const from of ['processing', 'done', 'failed'] as const) {
      expect(canTransition(embeddingJobMachine, from, 'pending')).toEqual({ ok: true, changed: true });
    }
  });

  it('is never finished without a worker having claimed it', () => {
    expect(canTransition(embeddingJobMachine, 'pending', 'done')).toEqual({ ok: false, code: 'illegal_transition' });
    expect(canTransition(embeddingJobMachine, 'done', 'failed')).toEqual({ ok: false, code: 'illegal_transition' });
    // A silent worker's job is taken over without leaving `processing`.
    expect(canTransition(embeddingJobMachine, 'processing', 'processing')).toEqual({ ok: true, changed: false });
  });
});
