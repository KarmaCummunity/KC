import type { KnowledgeSlotSeries, KnowledgeSlotSeriesStatus } from '@kc/domain';

/**
 * The weekly series of a recurring lesson offer (FR-KNOW-004 AC1, #2479; RPCs of the
 * `knowledge_slot_series` migrations). The series is started when the offer is published (the
 * marketplace adapter's create path); this port reads it and moves it. Errors keep the server's
 * code in their message (`knowledge_series_not_found`, `illegal_transition`).
 */
export interface IKnowledgeSlotSeriesRepository {
  /** The offer's series, readable by everyone who sees the offer; null when its times are one-off. */
  getForPost(postId: string): Promise<KnowledgeSlotSeries | null>;
  /** Giver or post editor: pause, resume or end. Booked sessions always stay. */
  setStatus(postId: string, status: KnowledgeSlotSeriesStatus): Promise<void>;
}
