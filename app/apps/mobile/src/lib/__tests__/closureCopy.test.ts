import { describe, expect, it } from 'vitest';
import { closureCopyKeys } from '../closureCopy';

describe('closureCopyKeys', () => {
  it('keeps item wording for a social give and a request', () => {
    expect(closureCopyKeys('Give', null).step2Title).toBe('closure.step2GiveTitle');
    expect(closureCopyKeys('Give', 'items').step2Title).toBe('closure.step2GiveTitle');
    expect(closureCopyKeys('Request', 'rides').step2Title).toBe('closure.step2RequestTitle');
  });

  it('names the person in the words of that world', () => {
    expect(closureCopyKeys('Give', 'rides').step2Title).toBe('closure.step2RidesTitle');
    expect(closureCopyKeys('Give', 'rides').step2Primary).toBe('closure.step2RidesPrimary');
    expect(closureCopyKeys('Give', 'housing').step2Title).toBe('closure.step2HousingTitle');
    expect(closureCopyKeys('Give', 'animals').step2Title).toBe('closure.step2AnimalsTitle');
    expect(closureCopyKeys('Give', 'food').step2Title).toBe('closure.step2FoodTitle');
    expect(closureCopyKeys('Give', 'knowledge').step2Title).toBe('closure.step2KnowledgeTitle');
  });
});
