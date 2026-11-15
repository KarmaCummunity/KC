import type { CrmContactPage, CrmOrg } from '@kc/domain';
import type { CrmContactListFilters, ICrmContactsRepository } from './ICrmContactsRepository';

export class ListCrmContactsUseCase {
  constructor(private readonly repo: ICrmContactsRepository) {}

  async execute(filters: CrmContactListFilters): Promise<CrmContactPage> {
    return this.repo.list(filters);
  }
}

/** FR-ADMIN-032 — the organizations whose contact book the viewer manages. */
export class ListCrmOrgsUseCase {
  constructor(private readonly repo: ICrmContactsRepository) {}

  execute(): Promise<readonly CrmOrg[]> {
    return this.repo.listOrgs();
  }
}
