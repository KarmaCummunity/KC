import { isValidOrgSlug, OrgHierarchyError } from '@kc/domain';
import type { IOrgHierarchyRepository } from './IOrgHierarchyRepository';

export interface SetOrgSlugInput {
  readonly orgId: string;
  /** The new page slug, as typed; it is trimmed and lower-cased before it is checked. */
  readonly slug: string;
}

/**
 * PM decision (FR-ORG-001 AC5): only the super admin changes an organization's page slug.
 * The slug is normalized and checked against the slug rule here so a typo fails fast; the
 * server (`admin_set_org_slug`) re-checks the rule, the uniqueness and the caller's role.
 */
export class SetOrgSlugUseCase {
  constructor(private readonly repo: IOrgHierarchyRepository) {}

  async execute(input: SetOrgSlugInput): Promise<string> {
    const slug = input.slug.trim().toLowerCase();
    if (!input.orgId) throw new OrgHierarchyError('invalid_input', 'org_id required');
    if (!isValidOrgSlug(slug)) throw new OrgHierarchyError('invalid_slug', 'slug breaks the slug rule');
    return this.repo.setOrgSlug(input.orgId, slug);
  }
}
