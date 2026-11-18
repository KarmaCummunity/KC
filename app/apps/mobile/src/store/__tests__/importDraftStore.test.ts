import { beforeEach, describe, expect, it } from 'vitest';
import { manualImportDraft } from '@kc/domain';
import { useImportDraftStore } from '../importDraftStore';

describe('importDraftStore', () => {
  beforeEach(() => useImportDraftStore.setState({ held: null, pendingImportId: null, seededDraft: null, review: null }));

  it('holds a draft with the pasted text and gives it out once', () => {
    const draft = manualImportDraft('ok');
    useImportDraftStore.getState().hold(draft, 'sofa for free');
    expect(useImportDraftStore.getState().take()).toEqual({ draft, pastedText: 'sofa for free' });
    expect(useImportDraftStore.getState().take()).toBeNull();
  });

  it('a newer draft replaces an older one nobody took', () => {
    useImportDraftStore.getState().hold(manualImportDraft('a'), 'first');
    useImportDraftStore.getState().hold(manualImportDraft('b'), 'second');
    expect(useImportDraftStore.getState().take()?.pastedText).toBe('second');
  });

  it('taking from an empty store is null', () => {
    expect(useImportDraftStore.getState().take()).toBeNull();
  });

  it('taking keeps the import id and the draft for later, each given out once', () => {
    const draft = { ...manualImportDraft('ok'), importId: 'imp-1' };
    useImportDraftStore.getState().hold(draft, 'text');
    useImportDraftStore.getState().take();
    expect(useImportDraftStore.getState().takeSeededDraft()).toBe(draft);
    expect(useImportDraftStore.getState().takeSeededDraft()).toBeNull();
    expect(useImportDraftStore.getState().consumePendingImportId()).toBe('imp-1');
    expect(useImportDraftStore.getState().consumePendingImportId()).toBeNull();
  });

  it('a new paste forgets what an earlier import left behind', () => {
    useImportDraftStore.getState().hold({ ...manualImportDraft('ok'), importId: 'old' }, 'a');
    useImportDraftStore.getState().take();
    useImportDraftStore.getState().hold(manualImportDraft('ok'), 'b');
    expect(useImportDraftStore.getState().consumePendingImportId()).toBeNull();
    expect(useImportDraftStore.getState().takeSeededDraft()).toBeNull();
  });

  it('taking sets the review notice from what the scrub removed and what to confirm', () => {
    const draft = {
      ...manualImportDraft('ok'),
      removed: { phone: 1, email: 0, id: 0, url: 0 },
      confirmFields: ['city'],
      truncated: false,
    };
    useImportDraftStore.getState().hold(draft, 'text');
    useImportDraftStore.getState().take();
    expect(useImportDraftStore.getState().review).toEqual({ removedContacts: true, confirmFields: ['city'], truncated: false, limit: null });
  });

  it('nothing removed means no contact notice', () => {
    useImportDraftStore.getState().hold({ ...manualImportDraft('ok'), removed: { phone: 0, email: 0, id: 0, url: 0 } }, 't');
    useImportDraftStore.getState().take();
    expect(useImportDraftStore.getState().review?.removedContacts).toBe(false);
  });

  it('forget clears the pending id, the seeded draft and the notice', () => {
    useImportDraftStore.getState().hold({ ...manualImportDraft('ok'), importId: 'imp-1' }, 't');
    useImportDraftStore.getState().take();
    useImportDraftStore.getState().forget();
    const s = useImportDraftStore.getState();
    expect([s.pendingImportId, s.seededDraft, s.review]).toEqual([null, null, null]);
  });

  it('a refused extraction carries its reason for the note; other manual reasons carry none', () => {
    useImportDraftStore.getState().hold(manualImportDraft('import_locked'), 't');
    useImportDraftStore.getState().take();
    expect(useImportDraftStore.getState().review?.limit).toBe('import_locked');
    useImportDraftStore.getState().hold(manualImportDraft('provider_failed'), 't');
    useImportDraftStore.getState().take();
    expect(useImportDraftStore.getState().review?.limit).toBeNull();
  });
});
