import { describe, expect, it } from 'vitest';
import { isPostEditableByOwner, isPostEnded, postAdminActions, postOwnerActions } from '../postActions';
import { POST_STATUSES } from '../posts';

/** The names of the owner actions offered in `status`, in a stable order. */
function offered(status: string): string {
  const actions = postOwnerActions(status);
  return Object.entries(actions)
    .filter(([, on]) => on)
    .map(([name]) => name)
    .join(',');
}

describe('postOwnerActions (post machine, spec 07 §7.1)', () => {
  it('offers on each status exactly what the graph lets the owner do', () => {
    expect(offered('draft')).toBe('edit');
    expect(offered('open')).toBe('edit,pause,close,delete');
    expect(offered('paused')).toBe('edit,resume,delete');
    expect(offered('closed_delivered')).toBe('reopen,delete');
    expect(offered('deleted_no_recipient')).toBe('reopen');
    expect(offered('expired')).toBe('delete,republish');
    expect(offered('hidden_pending_review')).toBe('delete');
    expect(offered('removed_admin')).toBe('');
  });

  it('covers every status of the machine, and offers nothing on a status it does not know', () => {
    for (const status of POST_STATUSES) {
      expect(() => postOwnerActions(status)).not.toThrow();
    }
    expect(offered('archived_by_a_newer_server')).toBe('');
  });

  it('never offers Delete on a post that is already deleted', () => {
    expect(postOwnerActions('deleted_no_recipient').delete).toBe(false);
  });

  it('lets the owner edit a draft, an open post and a paused one only', () => {
    expect(POST_STATUSES.filter(isPostEditableByOwner)).toEqual(['draft', 'open', 'paused']);
  });

  it('reads a delivered, a deleted and an expired post as ended', () => {
    expect(POST_STATUSES.filter(isPostEnded)).toEqual(['closed_delivered', 'deleted_no_recipient', 'expired']);
  });
});

describe('postAdminActions', () => {
  it('removes any post that is not removed, and gives back a removed or a hidden one', () => {
    for (const status of ['open', 'paused', 'closed_delivered', 'deleted_no_recipient', 'expired']) {
      expect(postAdminActions(status)).toEqual({ remove: true, restore: false });
    }
    expect(postAdminActions('hidden_pending_review')).toEqual({ remove: true, restore: true });
    expect(postAdminActions('removed_admin')).toEqual({ remove: false, restore: true });
    expect(postAdminActions('draft')).toEqual({ remove: false, restore: false });
  });
});
