import type { OrgTransparency } from '@kc/domain';
import type { IOrgTransparencyRepository } from './IOrgTransparencyRepository';

export class GetOrgTransparencyUseCase {
  constructor(private readonly repo: IOrgTransparencyRepository) {}

  execute(slug?: string): Promise<OrgTransparency> {
    return this.repo.getPublic(slug);
  }
}
