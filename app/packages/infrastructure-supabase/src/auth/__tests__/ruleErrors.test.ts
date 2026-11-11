import { describe, expect, it } from 'vitest';
import { BackendRuleError, BackendUnavailableError } from '@kc/domain';
import { mapRuleErrors } from '../ruleErrors';

class Mapped extends Error {}

describe('mapRuleErrors', () => {
  it('returns the result of a call that succeeds', async () => {
    await expect(mapRuleErrors(async () => 42, () => new Mapped())).resolves.toBe(42);
  });

  it('throws the mapped error for a stable refusal', async () => {
    const refusal = new BackendRuleError('underage', 'rpc:set_date_of_birth');

    const error = await mapRuleErrors(
      () => Promise.reject(refusal),
      (reason) => (reason === 'underage' ? new Mapped(reason) : null),
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Mapped);
    expect((error as Mapped).message).toBe('underage');
  });

  it('passes the refusal to the mapper so it can keep it as the cause', async () => {
    const refusal = new BackendRuleError('underage', 'rpc:set_date_of_birth');
    let seen: unknown;

    await mapRuleErrors(() => Promise.reject(refusal), (_reason, error) => {
      seen = error;
      return new Mapped();
    }).catch(() => undefined);

    expect(seen).toBe(refusal);
  });

  it('rethrows the refusal itself when the mapper has no error for its reason', async () => {
    const refusal = new BackendRuleError('user_not_found', 'rpc:set_date_of_birth');

    await expect(mapRuleErrors(() => Promise.reject(refusal), () => null)).rejects.toBe(refusal);
  });

  it('never maps a missing object or an unexpected failure', async () => {
    const missing = new BackendUnavailableError('rpc:x', 'function');
    const broken = new Error('timeout');

    await expect(mapRuleErrors(() => Promise.reject(missing), () => new Mapped())).rejects.toBe(missing);
    await expect(mapRuleErrors(() => Promise.reject(broken), () => new Mapped())).rejects.toBe(broken);
  });
});
