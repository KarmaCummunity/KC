import type { WorldContent } from '@kc/domain';
import type { IWorldContentRepository } from '../ports/IWorldContentRepository';

/** FR-FEED-020 AC2: the links and knowledge shown on a giving world's "links and knowledge" screen. */
export class GetWorldContentUseCase {
  constructor(private readonly repo: IWorldContentRepository) {}

  execute(worldSlug: string): Promise<WorldContent> {
    return this.repo.getWorldContent(worldSlug);
  }
}
