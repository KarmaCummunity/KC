// FR-ADMIN-037 AC13 — the "Copied from production" card's use cases: read what the weekly copy
// holds, and delete it.
import type { ProdCopyDeleteResult, ProdCopyStatus } from '@kc/domain';
import type { IProdCopyRepository } from './IProdCopyRepository';

export class GetProdCopyStatusUseCase {
  constructor(private readonly repo: IProdCopyRepository) {}
  execute(): Promise<ProdCopyStatus> {
    return this.repo.getStatus();
  }
}

export class DeleteProdCopyUseCase {
  constructor(private readonly repo: IProdCopyRepository) {}
  execute(): Promise<ProdCopyDeleteResult> {
    return this.repo.deleteAll();
  }
}
