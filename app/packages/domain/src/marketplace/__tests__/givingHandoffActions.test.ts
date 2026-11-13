// The actions a member is offered on a giving handoff are read from `givingHandoffMachine`
// and match what the handoff RPCs accept (supabase/schemas/25_handoffs/040_handoff_rpcs.sql).
import { describe, expect, it } from 'vitest';
import { GIVING_HANDOFF_STATUSES } from '../givingHandoff';
import { givingHandoffActions, isGivingHandoffLive, type GivingHandoffParty } from '../givingHandoffActions';

/** The offered actions as a sorted, comma-separated list. */
function offered(status: string, party: GivingHandoffParty): string {
  const actions = givingHandoffActions(status, party);
  return Object.entries(actions)
    .filter(([, isOffered]) => isOffered)
    .map(([name]) => name)
    .sort()
    .join(',');
}

describe('givingHandoffActions', () => {
  it('the owner answers a waiting request; the other member can only back out', () => {
    expect(offered('reserved', 'owner')).toBe('cancel,confirm');
    expect(offered('reserved', 'recipient')).toBe('cancel');
  });

  it('either member marks an approved handoff as handed over, or cancels it', () => {
    expect(offered('confirmed', 'owner')).toBe('cancel,complete');
    expect(offered('confirmed', 'recipient')).toBe('cancel,complete');
  });

  it('a waiting request is not handed over by this button, even by the owner', () => {
    expect(givingHandoffActions('reserved', 'owner').complete).toBe(false);
  });

  it('a completed hand-over is rated, and is not cancelled from here', () => {
    expect(offered('handed_over', 'owner')).toBe('rate');
    expect(offered('handed_over', 'recipient')).toBe('rate');
  });

  it('an ended handoff and an unknown status offer nothing', () => {
    for (const party of ['owner', 'recipient'] as const) {
      expect(offered('cancelled', party)).toBe('');
      expect(offered('no_show', party)).toBe('');
      expect(offered('a_newer_status', party)).toBe('');
    }
  });
});

describe('isGivingHandoffLive', () => {
  it('is true for a waiting or approved handoff only', () => {
    const live = GIVING_HANDOFF_STATUSES.filter((status) => isGivingHandoffLive(status));
    expect(live).toEqual(['reserved', 'confirmed']);
  });

  it('is false without a handoff and for an unknown status', () => {
    expect(isGivingHandoffLive(null)).toBe(false);
    expect(isGivingHandoffLive(undefined)).toBe(false);
    expect(isGivingHandoffLive('a_newer_status')).toBe(false);
  });
});
