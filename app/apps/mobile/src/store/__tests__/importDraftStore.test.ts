import { beforeEach, describe, expect, it } from 'vitest';
import { manualImportDraft } from '@kc/domain';
import { useImportDraftStore } from '../importDraftStore';

describe('importDraftStore', () => {
  beforeEach(() => useImportDraftStore.setState({ held: null }));

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
});
