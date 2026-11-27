// Unit coverage for the rides hub filter store (FR-RIDE-002 / TD-31 #1811).
// Sheet tests touch mode set/clear lightly; this file covers setters, clear,
// and activeFilterCount stacking in isolation.
import { beforeEach, describe, expect, it } from 'vitest';
import { useRidesFilterStore } from '../ridesFilterStore';

beforeEach(() => {
  useRidesFilterStore.getState().clearFilters();
});

describe('useRidesFilterStore — defaults', () => {
  it('starts with empty search and no city / mode / depart filters', () => {
    const s = useRidesFilterStore.getState();
    expect(s.searchQuery).toBe('');
    expect(s.originCityId).toBeNull();
    expect(s.originCityName).toBeNull();
    expect(s.destCityId).toBeNull();
    expect(s.destCityName).toBeNull();
    expect(s.mode).toBeNull();
    expect(s.departFrom).toBeNull();
    expect(s.departTo).toBeNull();
  });

  it('activeFilterCount() returns 0 on the default state', () => {
    expect(useRidesFilterStore.getState().activeFilterCount()).toBe(0);
  });
});

describe('useRidesFilterStore — setters', () => {
  it('setSearchQuery updates only the search text (not counted as a filter chip)', () => {
    useRidesFilterStore.getState().setSearchQuery('TLV airport');
    expect(useRidesFilterStore.getState().searchQuery).toBe('TLV airport');
    expect(useRidesFilterStore.getState().activeFilterCount()).toBe(0);
  });

  it('setOriginCity updates id and name together', () => {
    useRidesFilterStore.getState().setOriginCity('IL-001', 'Tel Aviv');
    const s = useRidesFilterStore.getState();
    expect(s.originCityId).toBe('IL-001');
    expect(s.originCityName).toBe('Tel Aviv');
  });

  it('setDestCity updates id and name together', () => {
    useRidesFilterStore.getState().setDestCity('IL-003', 'Haifa');
    const s = useRidesFilterStore.getState();
    expect(s.destCityId).toBe('IL-003');
    expect(s.destCityName).toBe('Haifa');
  });

  it('setMode accepts offer and request', () => {
    useRidesFilterStore.getState().setMode('offer');
    expect(useRidesFilterStore.getState().mode).toBe('offer');
    useRidesFilterStore.getState().setMode('request');
    expect(useRidesFilterStore.getState().mode).toBe('request');
  });

  it('setDepartRange updates from and to together', () => {
    useRidesFilterStore.getState().setDepartRange('2026-11-24T08:00:00Z', '2026-11-24T18:00:00Z');
    const s = useRidesFilterStore.getState();
    expect(s.departFrom).toBe('2026-11-24T08:00:00Z');
    expect(s.departTo).toBe('2026-11-24T18:00:00Z');
  });

  it('clearFilters restores every dimension including searchQuery', () => {
    const s = useRidesFilterStore.getState();
    s.setSearchQuery('north');
    s.setOriginCity('IL-001', 'Tel Aviv');
    s.setDestCity('IL-003', 'Haifa');
    s.setMode('offer');
    s.setDepartRange('2026-11-24T08:00:00Z', null);
    s.clearFilters();
    const out = useRidesFilterStore.getState();
    expect(out.searchQuery).toBe('');
    expect(out.originCityId).toBeNull();
    expect(out.destCityId).toBeNull();
    expect(out.mode).toBeNull();
    expect(out.departFrom).toBeNull();
    expect(out.departTo).toBeNull();
    expect(out.activeFilterCount()).toBe(0);
  });
});

describe('useRidesFilterStore — activeFilterCount', () => {
  it('counts origin city as 1 when id is non-null (name alone does not count)', () => {
    useRidesFilterStore.getState().setOriginCity(null, 'Tel Aviv');
    expect(useRidesFilterStore.getState().activeFilterCount()).toBe(0);
    useRidesFilterStore.getState().setOriginCity('IL-001', 'Tel Aviv');
    expect(useRidesFilterStore.getState().activeFilterCount()).toBe(1);
  });

  it('counts dest city as 1 when id is non-null', () => {
    useRidesFilterStore.getState().setDestCity('IL-003', 'Haifa');
    expect(useRidesFilterStore.getState().activeFilterCount()).toBe(1);
  });

  it('counts mode as 1 when set', () => {
    useRidesFilterStore.getState().setMode('request');
    expect(useRidesFilterStore.getState().activeFilterCount()).toBe(1);
  });

  it('counts depart range as 1 when either bound is set', () => {
    useRidesFilterStore.getState().setDepartRange('2026-11-24T08:00:00Z', null);
    expect(useRidesFilterStore.getState().activeFilterCount()).toBe(1);
    useRidesFilterStore.getState().clearFilters();
    useRidesFilterStore.getState().setDepartRange(null, '2026-11-24T18:00:00Z');
    expect(useRidesFilterStore.getState().activeFilterCount()).toBe(1);
    useRidesFilterStore.getState().setDepartRange('2026-11-24T08:00:00Z', '2026-11-24T18:00:00Z');
    // Both bounds still count as a single filter dimension.
    expect(useRidesFilterStore.getState().activeFilterCount()).toBe(1);
  });

  it('stacks origin + dest + mode + depart to 4 (searchQuery never adds)', () => {
    const s = useRidesFilterStore.getState();
    s.setSearchQuery('airport');
    s.setOriginCity('IL-001', 'Tel Aviv');
    s.setDestCity('IL-003', 'Haifa');
    s.setMode('offer');
    s.setDepartRange('2026-11-24T08:00:00Z', '2026-11-24T18:00:00Z');
    expect(useRidesFilterStore.getState().activeFilterCount()).toBe(4);
  });
});
