import { describe, expect, it } from 'vitest';
import { canTransition, isTerminal } from '../machine';
import { knowledgeTopicMachine } from '../machines/knowledgeTopic';
import { postCommentMachine } from '../machines/postComment';

describe('post comment machine', () => {
  it('deletes an active comment for good', () => {
    expect(canTransition(postCommentMachine, 'active', 'deleted')).toEqual({ ok: true, changed: true });
    expect(canTransition(postCommentMachine, 'deleted', 'active')).toEqual({ ok: false, code: 'illegal_transition' });
    expect(isTerminal(postCommentMachine, 'deleted')).toBe(true);
  });

  it('treats an edit as a same-status write', () => {
    expect(canTransition(postCommentMachine, 'active', 'active')).toEqual({ ok: true, changed: false });
  });
});

describe('knowledge topic machine', () => {
  it('approves a proposal and merges a proposal or an active topic', () => {
    expect(canTransition(knowledgeTopicMachine, 'proposed', 'active').ok).toBe(true);
    expect(canTransition(knowledgeTopicMachine, 'proposed', 'merged').ok).toBe(true);
    expect(canTransition(knowledgeTopicMachine, 'active', 'merged').ok).toBe(true);
  });

  it('never sends a topic back to proposed, and keeps a merge final', () => {
    expect(canTransition(knowledgeTopicMachine, 'active', 'proposed').ok).toBe(false);
    expect(canTransition(knowledgeTopicMachine, 'merged', 'active').ok).toBe(false);
    expect(isTerminal(knowledgeTopicMachine, 'merged')).toBe(true);
  });

  it('makes approving an active topic a no-op', () => {
    expect(canTransition(knowledgeTopicMachine, 'active', 'active')).toEqual({ ok: true, changed: false });
  });
});
