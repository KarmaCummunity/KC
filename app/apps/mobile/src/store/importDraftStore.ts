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
  hold: (draft: ImportDraft, pastedText: string) => void;
  /** Returns the held import and forgets it, so a later visit to the form does not prefill again. */
  take: () => HeldImport | null;
}

export const useImportDraftStore = create<ImportDraftState>((set, get) => ({
  held: null,
  hold: (draft, pastedText) => set({ held: { draft, pastedText } }),
  take: () => {
    const held = get().held;
    set({ held: null });
    return held;
  },
}));
