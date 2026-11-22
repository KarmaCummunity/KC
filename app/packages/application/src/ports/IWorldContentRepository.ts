import type { KnowledgeShelfLink, WorldContent } from '@kc/domain';

/** Reads the curated links and knowledge of a giving world (migration 0024). */
export interface IWorldContentRepository {
  /** The live related worlds, organizations and knowledge topics of one world; empty lists when it has none. */
  getWorldContent(worldSlug: string): Promise<WorldContent>;
  /** Official body links for one knowledge shelf (FR-KNOW-012 AC2); empty when none are configured. */
  listKnowledgeShelfLinks(shelfSlug: string): Promise<readonly KnowledgeShelfLink[]>;
}
