// Mapped to spec: FR-IMPORT-007 AC3.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { manualImportDraft } from '@kc/domain';

const execute = vi.fn();
vi.mock('../../services/importComposition', () => ({
  attachImportedPostUseCase: () => ({ execute }),
}));

import { attachPendingImport } from '../attachPendingImport';
import { useImportDraftStore } from '../../store/importDraftStore';

const draftWithId = (importId: string | null) => ({ ...manualImportDraft('ok'), importId });

describe('attachPendingImport', () => {
  beforeEach(() => {
    execute.mockReset();
    execute.mockResolvedValue(true);
    useImportDraftStore.setState({ held: null, pendingImportId: null, seededDraft: null, review: null, seededFields: {} });
  });

  it('does nothing when the post was not seeded from an import', async () => {
    await attachPendingImport('post-1');
    expect(execute).not.toHaveBeenCalled();
  });

  it('attaches the taken import to the published post, once', async () => {
    useImportDraftStore.getState().hold(draftWithId('imp-1'), 'text');
    useImportDraftStore.getState().take();
    await attachPendingImport('post-1');
    await attachPendingImport('post-2');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith({ importId: 'imp-1', postId: 'post-1', editedFields: undefined });
  });

  it('skips a draft with no import id (the function refused to run)', async () => {
    useImportDraftStore.getState().hold(draftWithId(null), 'text');
    useImportDraftStore.getState().take();
    await attachPendingImport('post-1');
    expect(execute).not.toHaveBeenCalled();
  });

  // FR-IMPORT-010 AC4 — the fields the member changed before publishing.
  it('reports the seeded fields the published post holds differently', async () => {
    useImportDraftStore.getState().hold(draftWithId('imp-1'), 'text');
    useImportDraftStore.getState().take();
    useImportDraftStore.getState().noteSeeded({ world: 'items', title: 'Sofa', city: 'c1' });
    await attachPendingImport('post-1', { world: 'items', title: 'Sofa bed', city: 'c1', description: 'x' });
    expect(execute).toHaveBeenCalledWith({ importId: 'imp-1', postId: 'post-1', editedFields: ['title'] });
  });

  it('a manual draft seeded nothing, so no edits are judged', async () => {
    useImportDraftStore.getState().hold(draftWithId('imp-1'), 'text');
    useImportDraftStore.getState().take();
    await attachPendingImport('post-1', { world: 'items', title: 'Mine' });
    expect(execute).toHaveBeenCalledWith({ importId: 'imp-1', postId: 'post-1', editedFields: undefined });
  });

  it('a failing service never escapes: the post stays published', async () => {
    execute.mockRejectedValue(new Error('network'));
    useImportDraftStore.getState().hold(draftWithId('imp-1'), 'text');
    useImportDraftStore.getState().take();
    await expect(attachPendingImport('post-1')).resolves.toBeUndefined();
  });
});
