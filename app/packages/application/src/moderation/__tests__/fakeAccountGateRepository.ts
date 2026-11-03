import type {
  IAccountGateRepository,
  AccountGateResult,
} from '../../ports/IAccountGateRepository';

export class FakeAccountGateRepository implements IAccountGateRepository {
  public result: AccountGateResult = { allowed: true };
  public calls: string[] = [];
  public restoreCalls = 0;
  public restoreError: Error | null = null;

  async checkAccountGate(userId: string): Promise<AccountGateResult> {
    this.calls.push(userId);
    return this.result;
  }

  async restoreAccount(): Promise<void> {
    this.restoreCalls += 1;
    if (this.restoreError) throw this.restoreError;
  }
}
