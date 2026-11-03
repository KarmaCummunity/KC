// FR-POST-007 AC1 — debounced (300 ms) write of the in-progress Create Post
// state to postDraftStore. The decision and payload builder live in
// `lib/postDraftFormState.ts` (pure, unit-tested); this file is the thin React
// wrapper around them.
import { useEffect, useRef } from 'react';
import { usePostDraftStore } from '../store/postDraftStore';
import {
  buildDraftPayload,
  shouldAutosaveDraft,
  type AutosaveGuards,
  type PostDraftFormState,
} from '../lib/postDraftFormState';

const AUTOSAVE_DEBOUNCE_MS = 300;

export type PostDraftAutosaveInput = AutosaveGuards & PostDraftFormState;

/**
 * Subscribes to the form state and writes a flat snapshot to the draft store
 * after `AUTOSAVE_DEBOUNCE_MS` of quiet (AC1). Returns nothing — the side effect
 * is the persist write itself.
 *
 * Address fields are intentionally **not** part of the draft. They live in
 * `lastAddressStore` with a different lifecycle (kept across publishes).
 */
export function usePostDraftAutosave(input: PostDraftAutosaveInput): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef(input);
  latestRef.current = input;

  useEffect(() => {
    const currentInput = latestRef.current;
    if (!shouldAutosaveDraft(currentInput, currentInput)) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const s = latestRef.current;
      if (!shouldAutosaveDraft(s, s)) return;
      // ownerId presence checked by the guard above.
      usePostDraftStore
        .getState()
        .setDraft(buildDraftPayload(s.ownerId as string, Date.now(), s));
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [
    input.ownerId,
    input.isHydrating,
    input.isResumePending,
    input.isPostCategory,
    input.type,
    input.title,
    input.description,
    input.category,
    input.condition,
    input.urgency,
    input.estimatedValue,
    input.locationDisplayLevel,
    input.visibility,
    input.hideFromCounterparty,
    input.uploads,
  ]);
}

export const POST_DRAFT_AUTOSAVE_DEBOUNCE_MS = AUTOSAVE_DEBOUNCE_MS;
