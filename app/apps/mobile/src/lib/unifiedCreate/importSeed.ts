// FR-IMPORT-007 AC1 — what the create form starts from when a member imports a post.
// The draft of the extraction (world, direction, sub-category, title, description, a picked city)
// is mapped to the form's own vocabulary; anything the extraction could not settle is left empty
// for the member, never guessed.
import type { ImportDraft, ListingKindOption, WorldSubcategory } from '@kc/domain';
import { WORLDS_WITH_SUBCATEGORY_PICKER, isCreateCategoryId, type CreateCategoryId, type CreateDirection } from './createCategories';
import { kindForDirection } from './listingFieldSpecs';

export interface ImportSeed {
  readonly categoryId: CreateCategoryId;
  /** null when the text did not say whether the member gives or asks: the form asks. */
  readonly direction: CreateDirection | null;
  readonly kindSlug: string | null;
  /** The world sub-category row, for the worlds that pick one. */
  readonly worldSubcategoryId: string | null;
  readonly title: string;
  readonly description: string;
  /** Only a city the catalog matched clearly; an unsure one stays a suggestion for the member. */
  readonly city: { readonly id: string; readonly name: string } | null;
  /** Fields to highlight for the member to confirm. */
  readonly confirmFields: readonly string[];
}

/** The lookups the mapping needs for the draft's world; the caller loads them for that world. */
export interface ImportSeedContext {
  readonly kinds: readonly ListingKindOption[];
  readonly subcategories: readonly WorldSubcategory[];
}

/** The extraction speaks offer / request; the create form speaks give / request. */
function directionOf(extracted: 'offer' | 'request' | 'unknown'): CreateDirection | null {
  if (extracted === 'offer') return 'give';
  return extracted === 'request' ? 'request' : null;
}

/**
 * The create form's starting point, or null when the draft has nothing to prefill (the manual
 * route, a non-post, or a world the form does not know): the member then creates the post by hand.
 */
export function importSeedFromDraft(draft: ImportDraft, context: ImportSeedContext): ImportSeed | null {
  const extraction = draft.extraction;
  if (draft.routing === 'manual' || !extraction?.isPost) return null;
  if (!isCreateCategoryId(extraction.worldSlug)) return null;

  const direction = directionOf(extraction.direction);
  const kind = direction ? kindForDirection(context.kinds, direction) : null;
  const picksSubcategory = WORLDS_WITH_SUBCATEGORY_PICKER.includes(extraction.worldSlug);
  const subcategory = picksSubcategory && extraction.subcategory
    ? context.subcategories.find((s) => s.slug === extraction.subcategory)
    : undefined;
  const city = draft.city?.status === 'picked' ? draft.city.picked : null;

  return {
    categoryId: extraction.worldSlug,
    direction,
    kindSlug: kind?.slug ?? null,
    worldSubcategoryId: subcategory?.categoryId ?? null,
    title: extraction.title ?? '',
    description: extraction.description ?? '',
    city: city ? { id: city.placeId, name: city.nameHe } : null,
    confirmFields: draft.confirmFields,
  };
}
