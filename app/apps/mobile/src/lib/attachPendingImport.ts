// Mapped to spec: FR-IMPORT-007 AC3 — a post published from an import draft is recorded as imported.
import { attachImportedPostUseCase } from '../services/importComposition';
import { useImportDraftStore } from '../store/importDraftStore';

/**
 * Links the just published post to the import the form was seeded from, if there is one. The
 * post already exists, so this never throws and never blocks the publish flow: a failure leaves a
 * normal post. The pending id is consumed first, so a second publish cannot reuse it.
 */
export async function attachPendingImport(postId: string): Promise<void> {
  const importId = useImportDraftStore.getState().consumePendingImportId();
  if (importId === null) return;
  await attachImportedPostUseCase().execute({ importId, postId });
}
