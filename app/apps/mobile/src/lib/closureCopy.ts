// FR-CLOSURE-002 / 003 / 011 — sheet wording follows the offer world, not a fixed "item" script.
import type { PostType } from '@kc/domain';

export interface ClosureCopyKeys {
  readonly step1Title: string;
  readonly step1Body: string;
  readonly step1Cta: string;
  readonly step2Title: string;
  readonly step2Primary: string;
  readonly chatsEmpty: string;
  /** Item and request posts keep the three-bullet explainer. Other worlds use one paragraph. */
  readonly explainerTitle: string;
  readonly explainerBody: string | null;
}

const ITEM_GIVE: ClosureCopyKeys = {
  step1Title: 'closure.step1GiveTitle',
  step1Body: 'closure.step1GiveBody',
  step1Cta: 'closure.step1GiveCta',
  step2Title: 'closure.step2GiveTitle',
  step2Primary: 'closure.step2MarkAndClose',
  chatsEmpty: 'closure.chatsEmpty',
  explainerTitle: 'closure.explainerGiveTitle',
  explainerBody: null,
};

const REQUEST: ClosureCopyKeys = {
  step1Title: 'closure.step1RequestTitle',
  step1Body: 'closure.step1RequestBody',
  step1Cta: 'closure.step1RequestCta',
  step2Title: 'closure.step2RequestTitle',
  step2Primary: 'closure.step2MarkAndClose',
  chatsEmpty: 'closure.chatsEmpty',
  explainerTitle: 'closure.explainerRequestTitle',
  explainerBody: null,
};

function worldCopy(
  step1Title: string,
  step1Body: string,
  step1Cta: string,
  step2Title: string,
  step2Primary: string,
  explainerTitle: string,
  explainerBody: string,
  namedOnly = true,
): ClosureCopyKeys {
  return {
    step1Title,
    step1Body,
    step1Cta,
    step2Title,
    step2Primary,
    chatsEmpty: namedOnly ? 'closure.chatsEmptyNamedOnly' : 'closure.chatsEmpty',
    explainerTitle,
    explainerBody,
  };
}

const BY_WORLD: Record<string, ClosureCopyKeys> = {
  food: worldCopy(
    'closure.step1FoodTitle',
    'closure.step1FoodBody',
    'closure.step1FoodCta',
    'closure.step2FoodTitle',
    'closure.step2MarkAndClose',
    'closure.explainerFoodTitle',
    'closure.explainerFoodBody',
    false,
  ),
  animals: worldCopy(
    'closure.step1AnimalsTitle',
    'closure.step1AnimalsBody',
    'closure.step1AnimalsCta',
    'closure.step2AnimalsTitle',
    'closure.step2MarkAndClose',
    'closure.explainerAnimalsTitle',
    'closure.explainerAnimalsBody',
    false,
  ),
  rides: worldCopy(
    'closure.step1RidesTitle',
    'closure.step1RidesBody',
    'closure.step1RidesCta',
    'closure.step2RidesTitle',
    'closure.step2RidesPrimary',
    'closure.explainerRidesTitle',
    'closure.explainerRidesBody',
  ),
  housing: worldCopy(
    'closure.step1HousingTitle',
    'closure.step1HousingBody',
    'closure.step1HousingCta',
    'closure.step2HousingTitle',
    'closure.step2HousingPrimary',
    'closure.explainerHousingTitle',
    'closure.explainerHousingBody',
  ),
  knowledge: worldCopy(
    'closure.step1KnowledgeTitle',
    'closure.step1KnowledgeBody',
    'closure.step1KnowledgeCta',
    'closure.step2KnowledgeTitle',
    'closure.step2KnowledgePrimary',
    'closure.explainerKnowledgeTitle',
    'closure.explainerKnowledgeBody',
  ),
  // #2078, D141: volunteering "takes place" whichever side posted it.
  time: worldCopy(
    'closure.step1TimeTitle',
    'closure.step1TimeBody',
    'closure.step1TimeCta',
    'closure.step2TimeTitle',
    'closure.step2TimePrimary',
    'closure.explainerTimeTitle',
    'closure.explainerTimeBody',
  ),
};

/** Worlds whose wording fits both an offer and a request, so a request does not fall back to items. */
const DIRECTION_NEUTRAL_WORLDS = new Set(['time']);

/** Give/request item copy, or the world's own wording. Unknown worlds stay on the item script. */
export function closureCopyKeys(postType: PostType | null, worldSlug: string | null): ClosureCopyKeys {
  if (worldSlug && DIRECTION_NEUTRAL_WORLDS.has(worldSlug)) return BY_WORLD[worldSlug];
  if (postType === 'Request') return REQUEST;
  if (worldSlug && BY_WORLD[worldSlug]) return BY_WORLD[worldSlug];
  return ITEM_GIVE;
}
