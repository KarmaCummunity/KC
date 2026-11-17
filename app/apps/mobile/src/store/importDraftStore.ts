// FR-IMPORT-007 AC1 — the draft of an import, handed from the paste screen to the create form.
// In memory only: the pasted text is the member's own and must not outlive the session, and the
// create form takes the draft exactly once.
import { create } from 'zustand';
import type { ImportDraft } from '@kc/domain';

export interface HeldImport {
  readonly draft: ImportDraft;
  /** What the member pasted, as they typed it; the manual route prefills the form with it. */
  readonly pastedText: string;
}

interface ImportDraftState {
  readonly held: HeldImport | null;
  /** The import the form was seeded from; read once at publish to record the post as imported. */
  readonly pendingImportId: string | null;
  hold: (draft: ImportDraft, pastedText: string) => void;
  /** Returns the held import and forgets it, so a later visit to the form does not prefill again. */
  take: () => HeldImport | null;
  /** Returns the pending import id and forgets it, so one import is attached to one post only. */
  consumePendingImportId: () => string | null;
}

export const useImportDraftStore = create<ImportDraftState>((set, get) => ({
  held: null,
  pendingImportId: null,
  hold: (draft, pastedText) => set({ held: { draft, pastedText } }),
  take: () => {
    const held = get().held;
    // The form now owns the draft; its import id waits here until the member publishes.
    set({ held: null, pendingImportId: held?.draft.importId ?? null });
    return held;
  },
  consumePendingImportId: () => {
    const id = get().pendingImportId;
    set({ pendingImportId: null });
    return id;
  },
}));
