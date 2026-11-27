import type { KnowledgeShelfLink } from '@kc/domain';
import type { IWorldContentRepository } from '../ports/IWorldContentRepository';

/** FR-KNOW-012 AC2 — official bodies configured for a knowledge shelf. */
export class ListKnowledgeShelfLinksUseCase {
  constructor(private readonly repo: IWorldContentRepository) {}

  execute(shelfSlug: string): Promise<readonly KnowledgeShelfLink[]> {
    return this.repo.listKnowledgeShelfLinks(shelfSlug);
  }
}
