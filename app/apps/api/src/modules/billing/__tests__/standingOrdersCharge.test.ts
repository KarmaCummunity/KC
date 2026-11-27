import { describe, expect, it } from 'vitest';
import { chargeDueStandingOrders, type DueCharge } from '../standingOrdersCharge';

const CHARGE: DueCharge = { intent_id: 'i1', standing_order_id: 's1', amount_agorot: 5000, mandate_ref: 'm1' };

function setup(over: { charges?: DueCharge[]; openFails?: boolean; submit?: (charge: DueCharge) => Promise<void> } = {}) {
  const limits: number[] = [];
  const reported: string[] = [];
  const run = (limit = 20) =>
    chargeDueStandingOrders(limit, {
      openDueCharges: (asked) => {
        limits.push(asked);
        return over.openFails ? Promise.reject(new Error('db down')) : Promise.resolve(over.charges ?? []);
      },
      submit: over.submit,
      report: (_error, intentId) => reported.push(intentId),
    });
  return { run, limits, reported };
}

describe('chargeDueStandingOrders', () => {
  it('opens at most the number of charges it was asked for', async () => {
    const { run, limits } = setup();

    expect(await run(5)).toEqual({ opened: 0, submitted: 0, failed: 0 });
    expect(limits).toEqual([5]);
  });

  it('counts the opened charges and leaves them for the provider events when no provider is wired', async () => {
    const { run } = setup({ charges: [CHARGE, { ...CHARGE, intent_id: 'i2' }] });

    expect(await run()).toEqual({ opened: 2, submitted: 0, failed: 0 });
  });

  it('submits every opened charge; one failure is reported by intent id and does not stop the others', async () => {
    const seen: string[] = [];
    const { run, reported } = setup({
      charges: [CHARGE, { ...CHARGE, intent_id: 'i2' }, { ...CHARGE, intent_id: 'i3' }],
      submit: (charge) => {
        seen.push(charge.intent_id);
        return charge.intent_id === 'i2' ? Promise.reject(new Error('provider down')) : Promise.resolve();
      },
    });

    expect(await run()).toEqual({ opened: 3, submitted: 2, failed: 1 });
    expect(seen).toEqual(['i1', 'i2', 'i3']);
    expect(reported).toEqual(['i2']);
  });

  it('rejects when the charges cannot be opened, so the run is reported as failed', async () => {
    const { run } = setup({ openFails: true });

    await expect(run()).rejects.toThrow('db down');
  });
});
