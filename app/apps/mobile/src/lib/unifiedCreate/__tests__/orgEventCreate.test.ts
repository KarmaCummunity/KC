// G1 step 5 (D31) — the time world's offer form: only a member of an organization may choose an
// organization's event; everyone else gets the default kind, and a single organization is preselected.
import { describe, expect, it } from 'vitest';
import { canChooseOrgEvent, kindForCreate, orgEventKind, preselectedOrgId } from '../orgEventCreate';
import { KINDS_BY_WORLD } from './listingKindFixtures';

const TIME = KINDS_BY_WORLD.time!;
const ONE_ORG = [{ orgId: 'o1', name: 'Food bank' }];
const TWO_ORGS = [...ONE_ORG, { orgId: 'o2', name: 'Shelter' }];

describe('canChooseOrgEvent', () => {
  it('offers the event to a member of an organization making an offer', () => {
    expect(canChooseOrgEvent(TIME, 'give', ONE_ORG)).toBe(true);
  });

  it('keeps today\'s form without an organization, for a request, or without the event kind', () => {
    expect(canChooseOrgEvent(TIME, 'give', [])).toBe(false);
    expect(canChooseOrgEvent(TIME, 'request', ONE_ORG)).toBe(false);
    expect(canChooseOrgEvent(KINDS_BY_WORLD.food!, 'give', ONE_ORG)).toBe(false);
  });
});

describe('kindForCreate', () => {
  it('publishes the event kind only when chosen', () => {
    expect(kindForCreate(TIME, 'give', true)?.slug).toBe('org_event');
    expect(kindForCreate(TIME, 'give', false)?.slug).toBe('volunteer_shift');
    expect(kindForCreate(TIME, 'request', false)?.slug).toBe('support_request');
  });

  it('finds no event kind in a world without one', () => {
    expect(orgEventKind(KINDS_BY_WORLD.rides!)).toBeNull();
    expect(kindForCreate(KINDS_BY_WORLD.rides!, 'give', true)).toBeNull();
  });
});

describe('preselectedOrgId', () => {
  it('preselects the only organization and leaves a choice of several to the member', () => {
    expect(preselectedOrgId(ONE_ORG)).toBe('o1');
    expect(preselectedOrgId(TWO_ORGS)).toBeNull();
    expect(preselectedOrgId([])).toBeNull();
  });
});

describe('kindForCreate — the kind a member picked among several', () => {
  const animals = KINDS_BY_WORLD.animals!;

  it('defaults to the first kind of the direction', () => {
    expect(kindForCreate(animals, 'give', false)?.slug).toBe('adoption_offer');
    expect(kindForCreate(animals, 'request', false, null)?.slug).toBe('adoption_request');
  });

  it('uses the chosen kind when it belongs to the direction', () => {
    expect(kindForCreate(animals, 'give', false, 'foster_offer')?.slug).toBe('foster_offer');
    expect(kindForCreate(animals, 'request', false, 'foster_request')?.slug).toBe('foster_request');
  });

  it('ignores a chosen kind of the other direction or an unknown one', () => {
    expect(kindForCreate(animals, 'request', false, 'foster_offer')?.slug).toBe('adoption_request');
    expect(kindForCreate(animals, 'give', false, 'nope')?.slug).toBe('adoption_offer');
  });
});
