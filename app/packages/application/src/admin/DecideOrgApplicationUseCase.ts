import { OrgApplicationError, isValidOrgSlug } from '@kc/domain';
import type { IOrgApplicationsRepository } from './IOrgApplicationsRepository';

export interface DecideOrgApplicationInput {
  readonly applicationId: string;
  readonly approve: boolean;
  /** The new organization's web address; required to approve (FR-ORG-002). */
  readonly slug?: string;
  readonly note?: string | null;
}

export class DecideOrgApplicationUseCase {
  constructor(private readonly repo: IOrgApplicationsRepository) {}

  async execute(input: DecideOrgApplicationInput): Promise<void> {
    if (!input.applicationId) {
      throw new OrgApplicationError('application_not_found', 'application_id required');
    }
    if (!input.approve) {
      await this.repo.reject(input.applicationId, input.note ?? null);
      return;
    }
    const slug = input.slug?.trim() ?? '';
    if (!isValidOrgSlug(slug)) throw new OrgApplicationError('invalid_slug');
    await this.repo.approve(input.applicationId, slug, input.note ?? null);
  }
}
