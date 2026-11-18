// FR-IMPORT-007 AC1 — the draft of an import, handed from the paste screen to the create form.
// In memory only: the pasted text is the member's own and must not outlive the session, and the
// create form takes the draft exactly once.
import { create } from 'zustand';
import type { ImportDraft, ImportFieldValues } from '@kc/domain';

export interface HeldImport {
  readonly draft: ImportDraft;
  /** What the member pasted, as they typed it; the manual route prefills the form with it. */
  readonly pastedText: string;
}

/** What the create form tells the member about the seeded draft (FR-IMPORT-007 AC2). */
export interface ImportReview {
  /** Contact details (phones, e-mails, IDs, links) were taken out of the text. */
  readonly removedContacts: boolean;
  /** Fields the pipeline was unsure of, for the member to check before publishing. */
  readonly confirmFields: readonly string[];
  /** The text was longer than the limit and only its start was read. */
  readonly truncated: boolean;
  /** Why no extraction ran (FR-IMPORT-008 AC3-AC4), for a "try later" note; null when it ran. */
  readonly limit: ImportLimitNote | null;
}

/** The refusals the member is told about; other manual reasons need no note. */
export const IMPORT_LIMIT_NOTES = ['rate_limited', 'budget_exhausted', 'import_locked', 'account_too_new'] as const;
export type ImportLimitNote = (typeof IMPORT_LIMIT_NOTES)[number];
const isLimitNote = (reason: string): reason is ImportLimitNote => (IMPORT_LIMIT_NOTES as readonly string[]).includes(reason);

function reviewOf(draft: ImportDraft): ImportReview {
  const r = draft.removed;
  return {
    removedContacts: r !== null && r.phone + r.email + r.id + r.url > 0,
    confirmFields: draft.confirmFields,
    truncated: draft.truncated,
    limit: isLimitNote(draft.reason) ? draft.reason : null,
  };
}

interface ImportDraftState {
  readonly held: HeldImport | null;
  /** The import the form was seeded from; read once at publish to record the post as imported. */
  readonly pendingImportId: string | null;
  /**
   * The draft the form was seeded from, kept for the world form (rides, food, housing, time), which
   * mounts after the basics are applied and seeds its own fields (kind, sub-category, city) once.
   */
  readonly seededDraft: ImportDraft | null;
  /** Shown above the form while it holds a seeded draft; null on a form opened without an import. */
  readonly review: ImportReview | null;
  /** What the draft put in the form, field by field, to tell at publish which fields the member changed. */
  readonly seededFields: ImportFieldValues;
  hold: (draft: ImportDraft, pastedText: string) => void;
  /** Returns the held import and forgets it, so a later visit to the form does not prefill again. */
  take: () => HeldImport | null;
  /** Returns the pending import id and forgets it, so one import is attached to one post only. */
  consumePendingImportId: () => string | null;
  /** Returns the seeded draft and forgets it, so the world form seeds its fields only once. */
  takeSeededDraft: () => ImportDraft | null;
  /** Adds what a prefill step put in the form (the basics, then the world form's own fields). */
  noteSeeded: (fields: ImportFieldValues) => void;
  /** The create form closed: whatever it was seeded from no longer applies to a later post. */
  forget: () => void;
}

export const useImportDraftStore = create<ImportDraftState>((set, get) => ({
  held: null,
  pendingImportId: null,
  seededDraft: null,
  review: null,
  seededFields: {},
  // A new paste starts over: nothing of an earlier import may leak into the next post.
  hold: (draft, pastedText) => set({ held: { draft, pastedText }, pendingImportId: null, seededDraft: null, review: null, seededFields: {} }),
  take: () => {
    const held = get().held;
    // The form now owns the draft; its import id waits here until the member publishes.
    set({
      held: null,
      pendingImportId: held?.draft.importId ?? null,
      seededDraft: held?.draft ?? null,
      review: held ? reviewOf(held.draft) : null,
    });
    return held;
  },
  consumePendingImportId: () => {
    const id = get().pendingImportId;
    set({ pendingImportId: null });
    return id;
  },
  takeSeededDraft: () => {
    const draft = get().seededDraft;
    set({ seededDraft: null });
    return draft;
  },
  noteSeeded: (fields) => set({ seededFields: { ...get().seededFields, ...fields } }),
  forget: () => set({ pendingImportId: null, seededDraft: null, review: null, seededFields: {} }),
}));
