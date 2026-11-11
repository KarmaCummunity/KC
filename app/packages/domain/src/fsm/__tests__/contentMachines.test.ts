import { describe, expect, it } from 'vitest';
import { canTransition, isTerminal } from '../machine';
import { postCommentMachine } from '../machines/postComment';

describe('post comment machine', () => {
  it('deletes an active comment for good', () => {
    for (const role of ['author', 'post_owner', 'admin']) {
      expect(canTransition(postCommentMachine, 'active', 'deleted', role)).toEqual({ ok: true, changed: true });
    }
    expect(canTransition(postCommentMachine, 'active', 'deleted', 'stranger')).toEqual({
      ok: false,
      code: 'forbidden_role',
    });
    expect(canTransition(postCommentMachine, 'deleted', 'active')).toEqual({ ok: false, code: 'illegal_transition' });
    expect(isTerminal(postCommentMachine, 'deleted')).toBe(true);
  });

  it('treats an edit as a same-status write', () => {
    expect(canTransition(postCommentMachine, 'active', 'active')).toEqual({ ok: true, changed: false });
  });
});

