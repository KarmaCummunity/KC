import type { KnowledgeTopic, KnowledgeTopicMatch } from '@kc/domain';

/** A member's proposal of a new topic (FR-KNOW-001 AC5); validated by the use case first. */
export interface ProposeKnowledgeTopicInput {
  readonly slug: string;
  readonly labelHe: string;
  readonly labelEn: string;
  readonly parentSlug?: string | null;
  readonly descriptionHe?: string | null;
}

/** Labels the proposer may still change while the topic waits for review. */
export interface KnowledgeTopicLabels {
  readonly labelHe: string;
  readonly labelEn: string;
  readonly descriptionHe?: string | null;
}

export type KnowledgeTopicReviewAction = 'approve' | 'reject' | 'rename' | 'merge';

/** An operator's review decision (FR-KNOW-001 AC5): `merge` needs `mergeIntoId`, `rename` new labels. */
export interface ReviewKnowledgeTopicInput {
  readonly topicId: string;
  readonly action: KnowledgeTopicReviewAction;
  readonly mergeIntoId?: string | null;
  readonly labelHe?: string | null;
  readonly labelEn?: string | null;
}

/**
 * The knowledge topic graph: the subject axis of every knowledge post and resource
 * (docs/spec/18 §18.3). Reads are public; proposals need a session; review is operator only
 * (enforced by the database, surfaced as `KnowledgeTopicError`).
 */
export interface IKnowledgeTopicRepository {
  /** Every topic, flat, including merged ones (callers build the tree, which drops them). */
  listTopics(): Promise<KnowledgeTopic[]>;

  /** Topics whose slug, label or alias matches a term of `text`, plus their descendants. */
  resolveTopics(text: string): Promise<KnowledgeTopicMatch[]>;

  proposeTopic(input: ProposeKnowledgeTopicInput): Promise<KnowledgeTopic>;

  updateMyProposal(topicId: string, labels: KnowledgeTopicLabels): Promise<KnowledgeTopic>;

  /** Returns the topic after the action; after `reject` it is the row that was removed. */
  reviewTopic(input: ReviewKnowledgeTopicInput): Promise<KnowledgeTopic>;

  /** Topic ids the signed-in member follows (own rows only, by RLS). */
  listFollowedTopicIds(): Promise<string[]>;

  /** Follows or unfollows a topic for the signed-in member; idempotent. */
  setTopicFollowed(topicId: string, followed: boolean): Promise<void>;
}
