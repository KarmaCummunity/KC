// FR-FEED-020 AC2 / FR-DONATE-011 / FR-KNOW-001 — the links and knowledge a giving world shows
// next to its posts (`world_links`, `external_bodies`, `knowledge_topics`, migration 0003).
// Pure vocabulary and rules; persistence lives behind `IWorldContentRepository`.
import type { DonationCategorySlug } from '../value-objects';
import type { KnowledgeTopic } from '../knowledge/knowledgeTopics';
import type { ExternalBodyOption } from '../marketplace/externalBodies';

/** A curated path from one giving world to a related one ("pet food" opens the food world). */
export interface WorldLink {
  readonly linkId: string;
  readonly fromWorldSlug: string;
  /** The world the link opens. */
  readonly toWorldSlug: string;
  /** Stable key of the link inside its world. */
  readonly linkSlug: string;
  readonly labelHe: string;
  readonly labelEn: string;
  readonly description: string | null;
}

/** Everything curated for one world: related worlds, its organizations and its knowledge topics. */
export interface WorldContent {
  readonly worldSlug: string;
  readonly links: readonly WorldLink[];
  readonly externalBodies: readonly ExternalBodyOption[];
  readonly topics: readonly KnowledgeTopic[];
}

/** How many community links the end of a world's feed shows before the "see all" button. */
export const WORLD_LINKS_PREVIEW_COUNT = 3;

/** A world with nothing curated yet; also the value shown while its content loads. */
export function emptyWorldContent(worldSlug: string): WorldContent {
  return { worldSlug, links: [], externalBodies: [], topics: [] };
}

/** True when the world has no related world, no organization and no topic to show. */
export function isWorldContentEmpty(content: WorldContent): boolean {
  return content.links.length === 0 && content.externalBodies.length === 0 && content.topics.length === 0;
}

/** Hebrew or English label of a row that carries both; falls back to the other when one is blank. */
export function localizedWorldLabel(row: { readonly labelHe: string; readonly labelEn: string }, language: string): string {
  const he = row.labelHe.trim();
  const en = row.labelEn.trim();
  return language.startsWith('he') ? he || en : en || he;
}

// The community link list of a world is keyed by the world's own slug, except where the list
// keeps its older name (rides → `transport`). The items world has no list.
const LINK_LIST_BY_WORLD: Readonly<Record<string, DonationCategorySlug>> = {
  food: 'food',
  rides: 'transport',
  time: 'time',
  money: 'money',
  knowledge: 'knowledge',
  housing: 'housing',
  medical: 'medical',
  animals: 'animals',
  employment: 'employment',
  democracy: 'democracy',
  challenges: 'challenges',
};

/** The world a community link list belongs to: the inverse of `worldLinkListSlug`. */
export function worldSlugOfLinkList(listSlug: DonationCategorySlug): string {
  return Object.keys(LINK_LIST_BY_WORLD).find((world) => LINK_LIST_BY_WORLD[world] === listSlug) ?? listSlug;
}

/** The community link list (`donation_link_categories.slug`) of a world, or null when it has none. */
export function worldLinkListSlug(worldSlug: string): DonationCategorySlug | null {
  return LINK_LIST_BY_WORLD[worldSlug] ?? null;
}
