// Spec 05 §5.11 (#1476): a job offer is published only in the name of an organization allowed to
// post jobs. Until the verification levels record the legal right to employ, a platform admin
// switches it per organization from the admin portal. The server re-checks the role.
import { ValidationError } from '@kc/domain';
import type { IOrgJobPostingAdminRepository, OrgJobPostingRow } from '../ports/IOrgJobPostingAdminRepository';

/** The organizations with their job-posting switch, for the admin screen. */
export class ListOrgJobPostingUseCase {
  constructor(private readonly repo: IOrgJobPostingAdminRepository) {}

  execute(): Promise<OrgJobPostingRow[]> {
    return this.repo.listOrganizations();
  }
}

export interface SetOrgMayPostJobsInput {
  readonly orgId: string;
  readonly enabled: boolean;
}

/** Allows or stops one organization posting job offers. */
export class SetOrgMayPostJobsUseCase {
  constructor(private readonly repo: IOrgJobPostingAdminRepository) {}

  async execute(input: SetOrgMayPostJobsInput): Promise<void> {
    if (!input.orgId.trim()) throw new ValidationError('an organization is required', 'orgId');
    await this.repo.setMayPostJobs(input.orgId, input.enabled);
  }
}
