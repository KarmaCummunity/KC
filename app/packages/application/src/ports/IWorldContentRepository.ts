import type { WorldContent } from '@kc/domain';

/** Reads the curated links and knowledge of a giving world (migration 0003). */
export interface IWorldContentRepository {
  /** The live related worlds, organizations and knowledge topics of one world; empty lists when it has none. */
  getWorldContent(worldSlug: string): Promise<WorldContent>;
}
