// Spec 17 §8.1 call 6 — which viewer gets a flow action on the listing detail, so that "message
// the owner" steps down to secondary beside it.
import { describe, expect, it } from 'vitest';
import { HANDOFF_WORLDS, listingFlowHasViewerAction } from '../listingFlow';

const give = (worldSlug: string) => ({ direction: 'give' as const, worldSlug, ownerId: 'u_owner' });

describe('listingFlowHasViewerAction', () => {
  it('offers a flow action to a signed-in non-owner on a give listing in a handoff or rides world', () => {
    for (const world of [...HANDOFF_WORLDS, 'rides', 'housing']) {
      expect(listingFlowHasViewerAction(give(world), 'u_viewer')).toBe(true);
    }
  });

  it('offers none to a guest, the owner, a request listing or a world without a flow', () => {
    expect(listingFlowHasViewerAction(give('items'), null)).toBe(false);
    expect(listingFlowHasViewerAction(give('items'), 'u_owner')).toBe(false);
    expect(listingFlowHasViewerAction({ ...give('items'), direction: 'request' }, 'u_viewer')).toBe(false);
    expect(listingFlowHasViewerAction(give('time'), 'u_viewer')).toBe(false);
  });
});
