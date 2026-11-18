// Mapped to spec: FR-POST-008 / FR-RESP-006 AC29 — the edit form of an items post marks what is
// missing under each part (title, photo for a give post, address) with the same rules as the create
// form. Nothing is marked before the first rejected save; each rejected save also bumps
// `failedSubmitCount`, which the form passes to `jumpToProblemSignal`.
import { useState } from 'react';
import {
  hasPostFieldErrors,
  postFieldErrors,
  type CreatePostFieldSnapshot,
  type PostFieldErrors,
} from '../lib/createPostFieldValidation';

const NO_ERRORS: PostFieldErrors = { title: null, photo: null, address: null };

export function useEditPostValidation(snapshot: CreatePostFieldSnapshot) {
  const [failedSubmitCount, setFailedSubmitCount] = useState(0);
  const current = postFieldErrors(snapshot);
  return {
    fieldErrors: failedSubmitCount > 0 ? current : NO_ERRORS,
    failedSubmitCount,
    /** True when the post may be saved; otherwise marks its parts and re-jumps to the first problem. */
    acceptSubmit: (): boolean => {
      if (!hasPostFieldErrors(current)) return true;
      setFailedSubmitCount((n) => n + 1);
      return false;
    },
  };
}
