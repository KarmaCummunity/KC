// FR-KNOW-001 (docs/spec/requirements/23_knowledge.md) — the subject axis of the knowledge world
// (docs/spec/18_knowledge_world.md §18.3, D119, S64). Three orthogonal axes place every
// knowledge object: the SHELF (a D100 sub-category of `public.categories`), the TOPIC (a node
// of the curated topic graph below) and the KIND (post or resource format). This module holds
// the pure vocabulary and rules; persistence lives behind `IKnowledgeTopicRepository`.
import { ValidationError } from '../errors';

/** The six D100 shelves of the knowledge world, in display order (`public.categories` slugs). */
export const KNOWLEDGE_SHELF_SLUGS = [
  'science_technology',
  'history_heritage',
  'culture_art',
  'spirituality_philosophy',
  'rights_legal_aid',
  'lessons_mentoring',
] as const;
export type KnowledgeShelfSlug = (typeof KNOWLEDGE_SHELF_SLUGS)[number];

export function isKnowledgeShelfSlug(value: string): value is KnowledgeShelfSlug {
  return (KNOWLEDGE_SHELF_SLUGS as readonly string[]).includes(value);
}

/** `active` is curated; `proposed` is usable at once and waits for review; `merged` keeps its slug as an alias. */
export type KnowledgeTopicStatus = 'active' | 'proposed' | 'merged';

export interface KnowledgeTopic {
  readonly topicId: string;
  readonly slug: string;
  readonly parentId: string | null;
  readonly labelHe: string;
  readonly labelEn: string;
  readonly descriptionHe: string | null;
  readonly status: KnowledgeTopicStatus;
  readonly mergedIntoId: string | null;
  readonly sortOrder: number;
}

/** A topic with its children, as the picker and the topic browser render it. */
export interface KnowledgeTopicNode extends KnowledgeTopic {
  readonly children: readonly KnowledgeTopicNode[];
}

/** One hit of `resolve_knowledge_topics`: the topic and the matched root it came from. */
export interface KnowledgeTopicMatch {
  readonly topicId: string;
  readonly slug: string;
  readonly matchedSlug: string;
  readonly via: 'self' | 'descendant';
}

/** Limits mirrored from migration `0570` so the form fails before the round trip. */
export const KNOWLEDGE_TOPIC_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const KNOWLEDGE_TOPIC_SLUG_MAX = 64;
export const KNOWLEDGE_TOPIC_LABEL_MAX = 80;
export const KNOWLEDGE_TOPIC_DESCRIPTION_MAX = 280;
export const KNOWLEDGE_TOPIC_MAX_DEPTH = 4;
/** One primary topic plus up to four more on a post or resource (FR-KNOW-002). */
export const KNOWLEDGE_TOPICS_PER_OBJECT_MAX = 5;

// Written as code points (no Hebrew literals outside locale files, D-24): U+0591-U+05C7 are the
// niqqud and cantillation marks; U+05D0-U+05EA the letters alef-tav.
const HEBREW_POINTS = /[\u0591-\u05C7]/g;
const NON_LETTER = /[^a-z0-9\u05D0-\u05EA]+/g;
// Final kaf, mem, nun, pe, tsadi -> their base letters.
const HEBREW_FINAL_LETTERS = /[\u05DA\u05DD\u05DF\u05E3\u05E5]/g;
const FINAL_TO_BASE: Readonly<Record<string, string>> = {
  '\u05DA': '\u05DB',
  '\u05DD': '\u05DE',
  '\u05DF': '\u05E0',
  '\u05E3': '\u05E4',
  '\u05E5': '\u05E6',
};

/**
 * The same normalization as `public.knowledge_normalize_text`, for client-side filtering of
 * the picker: lower-case, niqqud stripped, Hebrew final letters folded, punctuation turned
 * into single spaces, so a geresh or a dash inside a word compares equal to a space.
 */
export function normalizeKnowledgeText(text: string | null | undefined): string {
  return (text ?? '')
    .toLowerCase()
    .replace(HEBREW_POINTS, '')
    .replace(HEBREW_FINAL_LETTERS, (letter) => FINAL_TO_BASE[letter] ?? letter)
    .replace(NON_LETTER, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export interface KnowledgeTopicProposal {
  readonly slug: string;
  readonly labelHe: string;
  readonly labelEn: string;
  readonly parentSlug?: string | null;
  readonly descriptionHe?: string | null;
}

/** Trims a proposal and throws `ValidationError` (field named) on the first broken rule. */
export function validateKnowledgeTopicProposal(input: KnowledgeTopicProposal): KnowledgeTopicProposal {
  const slug = input.slug.trim().toLowerCase();
  if (!KNOWLEDGE_TOPIC_SLUG_PATTERN.test(slug) || slug.length > KNOWLEDGE_TOPIC_SLUG_MAX) {
    throw new ValidationError('Topic slug must be lower-case kebab-case', 'slug');
  }
  const labelHe = requireLabel(input.labelHe, 'labelHe');
  const labelEn = requireLabel(input.labelEn, 'labelEn');
  const descriptionHe = input.descriptionHe?.trim() || null;
  if (descriptionHe && descriptionHe.length > KNOWLEDGE_TOPIC_DESCRIPTION_MAX) {
    throw new ValidationError('Topic description is too long', 'descriptionHe');
  }
  const parentSlug = input.parentSlug?.trim() || null;
  if (parentSlug && !KNOWLEDGE_TOPIC_SLUG_PATTERN.test(parentSlug)) {
    throw new ValidationError('Parent slug is malformed', 'parentSlug');
  }
  return { slug, labelHe, labelEn, descriptionHe, parentSlug };
}

function requireLabel(value: string, field: string): string {
  const label = value.trim();
  if (label.length === 0 || label.length > KNOWLEDGE_TOPIC_LABEL_MAX) {
    throw new ValidationError('Topic label must be 1–80 characters', field);
  }
  return label;
}

/**
 * Arranges a flat topic list into roots with nested children, in `sortOrder` then Hebrew
 * label order. Merged topics are left out: they resolve through their alias only.
 * A topic whose parent is missing from the list is treated as a root, so a partial fetch
 * still renders.
 */
export function buildKnowledgeTopicTree(topics: readonly KnowledgeTopic[]): KnowledgeTopicNode[] {
  const live = topics.filter((topic) => topic.status !== 'merged');
  const ids = new Set(live.map((topic) => topic.topicId));
  const byParent = new Map<string | null, KnowledgeTopic[]>();
  for (const topic of live) {
    const key = topic.parentId !== null && ids.has(topic.parentId) ? topic.parentId : null;
    const siblings = byParent.get(key) ?? [];
    siblings.push(topic);
    byParent.set(key, siblings);
  }
  const attach = (parentId: string | null): KnowledgeTopicNode[] =>
    (byParent.get(parentId) ?? [])
      .slice()
      .sort(compareTopics)
      .map((topic) => ({ ...topic, children: attach(topic.topicId) }));
  return attach(null);
}

function compareTopics(a: KnowledgeTopic, b: KnowledgeTopic): number {
  return a.sortOrder - b.sortOrder || a.labelHe.localeCompare(b.labelHe, 'he');
}

/**
 * The topics selected on a post or resource: exactly one primary and at most four more,
 * no repeats (FR-KNOW-002 AC1). Throws `ValidationError` otherwise.
 */
export function validateKnowledgeTopicSelection(primaryTopicId: string, additionalTopicIds: readonly string[]): void {
  if (!primaryTopicId) throw new ValidationError('A primary topic is required', 'primaryTopicId');
  const unique = new Set(additionalTopicIds);
  if (unique.size !== additionalTopicIds.length || unique.has(primaryTopicId)) {
    throw new ValidationError('Topics may not repeat', 'additionalTopicIds');
  }
  if (additionalTopicIds.length > KNOWLEDGE_TOPICS_PER_OBJECT_MAX - 1) {
    throw new ValidationError('Too many additional topics', 'additionalTopicIds');
  }
}
