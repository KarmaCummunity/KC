// Mapped to spec: FR-IMPORT-007 AC3 — a post published from an import draft is recorded as imported;
// FR-IMPORT-010 AC4 — with the draft fields the member changed before publishing.
import { editedImportFields, type ImportFieldValues } from '@kc/domain';
import { useImportDraftStore } from '../store/importDraftStore';

/**
 * Links the just published post to the import the form was seeded from, if there is one, and
 * reports which seeded fields the member changed (`published`: the post's values, field by field). The
 * post already exists, so this never throws and never blocks the publish flow: a failure leaves a
 * normal post. The pending id is consumed first, so a second publish cannot reuse it.
 */
export async function attachPendingImport(postId: string, published?: ImportFieldValues): Promise<void> {
  const store = useImportDraftStore.getState();
  const seeded = store.seededFields;
  const importId = store.consumePendingImportId();
  if (importId === null) return;
  // FR-IMPORT-010 AC4: which seeded fields the member changed; only for a draft that seeded any.
  const editedFields = published && Object.keys(seeded).length > 0 ? editedImportFields(seeded, published) : undefined;
  // Loaded only when there is an import to attach: the publish paths that import this helper do
  // not pull the import service (and its backend client) into every form that never imports.
  try {
    const { attachImportedPostUseCase } = await import('../services/importComposition');
    await attachImportedPostUseCase().execute({ importId, postId, editedFields });
  } catch {
    // The post is published either way; a link that could not be made leaves a normal post.
  }
}
