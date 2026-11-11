import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  canTransitionPostStatus,
  validatePostStatusTransition,
  PostStatusTransitionError,
  POST_STATUSES,
  type PostStatus,
} from '../posts';
import { postMachine } from '../fsm/machines/post';
import { isTerminal } from '../fsm/machine';

describe('S1 Post Status State Machine (Spec 07 §7.1, D104)', () => {
  it('defines all 8 post statuses', () => {
    expect(POST_STATUSES).toHaveLength(8);
    expect(POST_STATUSES).toEqual([
      'draft',
      'open',
      'paused',
      'closed_delivered',
      'deleted_no_recipient',
      'expired',
      'hidden_pending_review',
      'removed_admin',
    ]);
  });

  it('declares exactly the PostStatus union in the kernel machine', () => {
    // Compile-time: both directions of assignability between the union and the machine.
    expectTypeOf<(typeof postMachine.states)[number]>().toEqualTypeOf<PostStatus>();
    expect(postMachine.id).toBe('post');
    expect(postMachine.edges).toHaveLength(30);
  });

  it('has no terminal status: every status can still be moderated or restored', () => {
    for (const status of POST_STATUSES) expect(isTerminal(postMachine, status)).toBe(false);
  });

  describe('valid transitions', () => {
    it('allows all expected transitions from open', () => {
      const allowed: PostStatus[] = [
        'paused',
        'closed_delivered',
        'deleted_no_recipient',
        'expired',
        'removed_admin',
        'hidden_pending_review',
      ];
      for (const to of allowed) {
        expect(canTransitionPostStatus('open', to)).toBe(true);
        expect(() => validatePostStatusTransition('open', to)).not.toThrow();
      }
    });

    it('allows all expected transitions from paused', () => {
      const allowed: PostStatus[] = [
        'open',
        'deleted_no_recipient',
        'expired',
        'removed_admin',
        'hidden_pending_review',
      ];
      for (const to of allowed) {
        expect(canTransitionPostStatus('paused', to)).toBe(true);
        expect(() => validatePostStatusTransition('paused', to)).not.toThrow();
      }
    });

    it('allows reopening from closed_delivered and unmark-self', () => {
      const allowed: PostStatus[] = [
        'open',
        'deleted_no_recipient',
        'removed_admin',
        'hidden_pending_review',
      ];
      for (const to of allowed) {
        expect(canTransitionPostStatus('closed_delivered', to)).toBe(true);
        expect(() => validatePostStatusTransition('closed_delivered', to)).not.toThrow();
      }
    });

    it('allows deleting and moderating an expired post', () => {
      const allowed: PostStatus[] = [
        'deleted_no_recipient',
        'removed_admin',
        'hidden_pending_review',
      ];
      for (const to of allowed) {
        expect(canTransitionPostStatus('expired', to)).toBe(true);
        expect(() => validatePostStatusTransition('expired', to)).not.toThrow();
      }
    });

    it('allows restoring from hidden_pending_review', () => {
      const allowed: PostStatus[] = [
        'open',
        'closed_delivered',
        'deleted_no_recipient',
        'removed_admin',
      ];
      for (const to of allowed) {
        expect(canTransitionPostStatus('hidden_pending_review', to)).toBe(true);
        expect(() => validatePostStatusTransition('hidden_pending_review', to)).not.toThrow();
      }
    });

    it('allows reopening grace and removal from deleted_no_recipient', () => {
      const allowed: PostStatus[] = ['open', 'removed_admin'];
      for (const to of allowed) {
        expect(canTransitionPostStatus('deleted_no_recipient', to)).toBe(true);
        expect(() => validatePostStatusTransition('deleted_no_recipient', to)).not.toThrow();
      }
    });

    it('allows admin restore from removed_admin to the status saved before the removal', () => {
      const restorable: PostStatus[] = ['open', 'paused', 'closed_delivered', 'deleted_no_recipient', 'expired'];
      for (const to of restorable) {
        expect(canTransitionPostStatus('removed_admin', to)).toBe(true);
        expect(() => validatePostStatusTransition('removed_admin', to)).not.toThrow();
      }
    });
  });

  describe('invalid transitions', () => {
    it('rejects same-status transitions as no-ops', () => {
      for (const status of POST_STATUSES) {
        expect(canTransitionPostStatus(status, status)).toBe(false);
        expect(() => validatePostStatusTransition(status, status)).toThrow(PostStatusTransitionError);
      }
    });

    it('rejects illegal transitions from paused', () => {
      expect(canTransitionPostStatus('paused', 'closed_delivered')).toBe(false);
      expect(() => validatePostStatusTransition('paused', 'closed_delivered')).toThrow(PostStatusTransitionError);
    });

    it('rejects illegal transitions from closed_delivered', () => {
      expect(canTransitionPostStatus('closed_delivered', 'paused')).toBe(false);
      expect(canTransitionPostStatus('closed_delivered', 'expired')).toBe(false);
      expect(() => validatePostStatusTransition('closed_delivered', 'paused')).toThrow(PostStatusTransitionError);
    });

    it('rejects reopening an expired post: it is republished as a new post', () => {
      expect(canTransitionPostStatus('expired', 'open')).toBe(false);
      expect(() => validatePostStatusTransition('expired', 'open')).toThrow(PostStatusTransitionError);
    });

    it('rejects illegal transitions from expired', () => {
      expect(canTransitionPostStatus('expired', 'paused')).toBe(false);
      expect(canTransitionPostStatus('expired', 'closed_delivered')).toBe(false);
      expect(() => validatePostStatusTransition('expired', 'paused')).toThrow(PostStatusTransitionError);
    });

    it('rejects illegal transitions from deleted_no_recipient', () => {
      const forbidden: PostStatus[] = ['paused', 'closed_delivered', 'expired', 'hidden_pending_review'];
      for (const to of forbidden) {
        expect(canTransitionPostStatus('deleted_no_recipient', to)).toBe(false);
        expect(() => validatePostStatusTransition('deleted_no_recipient', to)).toThrow(PostStatusTransitionError);
      }
    });

    it('rejects sending a removed post back to review', () => {
      expect(canTransitionPostStatus('removed_admin', 'hidden_pending_review')).toBe(false);
      expect(() => validatePostStatusTransition('removed_admin', 'hidden_pending_review')).toThrow(
        PostStatusTransitionError,
      );
    });
  });

  describe('error shape', () => {
    it('sets proper error properties on PostStatusTransitionError', () => {
      try {
        validatePostStatusTransition('removed_admin', 'hidden_pending_review');
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(PostStatusTransitionError);
        const e = err as PostStatusTransitionError;
        expect(e.code).toBe('posts_status_transition_invalid');
        expect(e.from).toBe('removed_admin');
        expect(e.to).toBe('hidden_pending_review');
        expect(e.message).toContain('Cannot transition post status from removed_admin to hidden_pending_review');
      }
    });
  });
});
