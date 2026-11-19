import type { IdentityVerificationSummary } from '@kc/domain';
import type { IIdentityVerificationService } from '../ports/IIdentityVerificationService';

// FR-VERIFY-003 AC2 — the member's own status page. Refreshed after the provider flow closes;
// the client "done" redirect never sets a level, it only re-reads this (FR-VERIFY-005 AC4).

export class GetIdentityVerificationStatusUseCase {
  constructor(private readonly service: IIdentityVerificationService) {}

  execute(): Promise<IdentityVerificationSummary> {
    return this.service.getStatus();
  }
}
