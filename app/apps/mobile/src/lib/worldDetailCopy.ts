// FR-CLOSURE-011 / FR-FEED-020 (#2539): per-world language of the post detail chrome, in one place.
// The detail screen title, the owner close / reopen actions, the closed-status pill and the
// photo placeholder all read the same world slug, so a job never says "delivered" and wears a gift.
// Stored statuses (`closed_delivered`) and the close RPCs are untouched: this is copy and icons only.
import type { Ionicons } from '@expo/vector-icons';
import type { PostType } from '@kc/domain';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/** Screen title per world. Rides keep the key of their dedicated route so the two stay in sync. */
const TITLE_KEY: Readonly<Record<string, string>> = {
  employment: 'post.detail.worldTitle.employment',
  items: 'post.detail.worldTitle.items',
  rides: 'donations.rides.detailTitle',
  knowledge: 'post.detail.worldTitle.knowledge',
  time: 'post.detail.worldTitle.time',
  food: 'post.detail.worldTitle.food',
  housing: 'post.detail.worldTitle.housing',
  animals: 'post.detail.worldTitle.animals',
  money: 'post.detail.worldTitle.money',
  medical: 'post.detail.worldTitle.medical',
  challenges: 'post.detail.worldTitle.challenges',
};

/** Owner close CTA for an open offer. Items keep "delivered"; the rest name what actually happened. */
const OFFER_CTA_KEY: Readonly<Record<string, string>> = {
  items: 'closure.markGiveCta',
  animals: 'closure.markAnimalsCta',
  housing: 'closure.markHousingCta',
  rides: 'closure.markRidesCta',
  // #2078, D141: volunteering takes place; it is not delivered.
  time: 'closure.markTimeCta',
  employment: 'closure.markEmploymentCta',
  knowledge: 'closure.markKnowledgeCta',
  food: 'closure.markFoodCta',
  money: 'closure.markMoneyCta',
  medical: 'closure.markMedicalCta',
  challenges: 'closure.markChallengesCta',
};

/** Closed-status pill. A world absent here (and the generic case) reads "Completed". */
const CLOSED_STATUS_KEY: Readonly<Record<string, string>> = {
  employment: 'post.detail.worldClosed.employment',
  knowledge: 'post.detail.worldClosed.knowledge',
  food: 'post.detail.worldClosed.food',
  money: 'post.detail.worldClosed.money',
  medical: 'post.detail.worldClosed.medical',
  challenges: 'post.detail.worldClosed.challenges',
};

/** Photo placeholder per world. */
const PLACEHOLDER_ICON: Readonly<Record<string, IconName>> = {
  rides: 'car-outline',
  food: 'restaurant-outline',
  items: 'gift-outline',
  housing: 'home-outline',
  knowledge: 'school-outline',
  time: 'time-outline',
  animals: 'paw-outline',
  employment: 'briefcase-outline',
  money: 'cash-outline',
  medical: 'medkit-outline',
  challenges: 'trophy-outline',
  democracy: 'megaphone-outline',
};

/** Header title of the post detail screen; `null` (a plain post) and unknown worlds read "Post details". */
export function worldDetailTitleKey(worldSlug: string | null): string {
  return (worldSlug !== null && TITLE_KEY[worldSlug]) || 'post.detailTitle';
}

/**
 * Owner's primary close action. A plain post (`null` world) is an item hand-over and keeps
 * "delivered"; a world with no wording of its own (democracy, any new world) falls back to "completed".
 */
export function worldOwnerMarkCtaKey(worldSlug: string | null, direction: PostType = 'Give'): string {
  if (direction === 'Request') {
    return worldSlug === 'employment' ? 'closure.markEmploymentRequestCta' : 'closure.markRequestCta';
  }
  if (worldSlug === null) return 'closure.markGiveCta';
  return OFFER_CTA_KEY[worldSlug] ?? 'closure.markCompletedCta';
}

/** Owner "it did not happen after all" (reopen) label and its a11y label; item wording only for items. */
export function worldReopenCtaKeys(worldSlug: string | null): { label: string; a11y: string } {
  const itemWorld = worldSlug === null || worldSlug === 'items';
  return itemWorld
    ? { label: 'closure.itemNotDeliveredCta', a11y: 'closure.itemNotDeliveredA11y' }
    : { label: 'closure.notCompletedCta', a11y: 'closure.notCompletedA11y' };
}

/** Label of the closed pill on the detail hero. */
export function worldClosedStatusKey(worldSlug: string | null): string {
  return (worldSlug !== null && CLOSED_STATUS_KEY[worldSlug]) || 'post.detail.statusClosed';
}

/** Placeholder icon for a post without photos; a plain post falls back to its direction. */
export function worldPlaceholderIcon(worldSlug: string | null, direction: PostType = 'Give'): IconName {
  if (worldSlug !== null) return PLACEHOLDER_ICON[worldSlug] ?? 'pricetag-outline';
  return direction === 'Give' ? 'gift-outline' : 'search-outline';
}
