// Pure helpers for FR-POST-007 draft state — kept separate from the
// autosave/hydration hooks so the "should we save?" rule + payload builder
// have a single source of truth and are unit-testable without React.
import type {
  Category,
  ItemCondition,
  LocationDisplayLevel,
  PostType,
  PostVisibility,
} from '@kc/domain';
import type { UploadedAsset } from '../services/imageUpload';
import type { PostDraftPayload } from '../store/postDraftStore';

export interface PostDraftFormState {
  readonly type: PostType;
  readonly title: string;
  readonly description: string;
  readonly category: Category;
  readonly condition: ItemCondition;
  readonly urgency: string;
  readonly estimatedValue: number;
  readonly locationDisplayLevel: LocationDisplayLevel;
  readonly visibility: PostVisibility;
  readonly hideFromCounterparty: boolean;
  readonly uploads: readonly UploadedAsset[];
}

export interface AutosaveGuards {
  readonly ownerId: string | undefined;
  readonly isHydrating: boolean;
  readonly isResumePending: boolean;
  /**
   * False while a listing category (rides / food / housing / time) is open: drafts are items
   * posts only, so a listing title typed there must not become an items draft (FR-POST-001 AC6).
   */
  readonly isPostCategory: boolean;
}

export const POST_DRAFT_DEFAULTS: PostDraftFormState = {
  type: 'Give',
  title: '',
  description: '',
  category: 'Other',
  condition: 'Good',
  urgency: '',
  estimatedValue: 0,
  locationDisplayLevel: 'CityAndStreet',
  visibility: 'Public',
  hideFromCounterparty: false,
  uploads: [],
};

/**
 * Returns true when every field matches the canonical defaults shown to a
 * brand-new visitor of the Create Post screen.
 */
export function isFormStateAtDefaults(s: PostDraftFormState): boolean {
  return (
    s.type === POST_DRAFT_DEFAULTS.type &&
    s.title.length === 0 &&
    s.description.length === 0 &&
    s.category === POST_DRAFT_DEFAULTS.category &&
    s.condition === POST_DRAFT_DEFAULTS.condition &&
    s.urgency.length === 0 &&
    s.estimatedValue === POST_DRAFT_DEFAULTS.estimatedValue &&
    s.locationDisplayLevel === POST_DRAFT_DEFAULTS.locationDisplayLevel &&
    s.visibility === POST_DRAFT_DEFAULTS.visibility &&
    s.hideFromCounterparty === POST_DRAFT_DEFAULTS.hideFromCounterparty &&
    s.uploads.length === 0
  );
}

/**
 * The full set of guards the autosave hook consults before scheduling a write.
 * Pure — driven by tests.
 */
export function shouldAutosaveDraft(guards: AutosaveGuards, state: PostDraftFormState): boolean {
  if (!guards.ownerId) return false;
  if (guards.isHydrating) return false;
  if (guards.isResumePending) return false;
  if (!guards.isPostCategory) return false;
  // The direction alone is not content: it is remembered on its own (FR-POST-001 AC6), so a
  // restored "request" toggle on an empty form must not produce a draft.
  if (isFormStateAtDefaults({ ...state, type: POST_DRAFT_DEFAULTS.type })) return false;
  return true;
}

/** Pure mapping from form state → persisted payload. */
export function buildDraftPayload(
  ownerId: string,
  nowMs: number,
  state: PostDraftFormState,
): PostDraftPayload {
  return {
    ownerId,
    updatedAt: nowMs,
    type: state.type,
    title: state.title,
    description: state.description,
    category: state.category,
    condition: state.condition,
    urgency: state.urgency,
    estimatedValue: state.estimatedValue,
    locationDisplayLevel: state.locationDisplayLevel,
    visibility: state.visibility,
    hideFromCounterparty: state.hideFromCounterparty,
    uploads: [...state.uploads],
  };
}
