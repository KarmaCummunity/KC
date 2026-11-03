// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAddressStateWithCityReset } from '../useAddressStateWithCityReset';

describe('useAddressStateWithCityReset', () => {
  it('preserves address fields when the city id is unchanged', () => {
    const city = { id: 'city-1', name: 'City One' };
    const { result } = renderHook(() => useAddressStateWithCityReset({ city, street: 'Main', streetNumber: '5' }));
    act(() => result.current.setCity({ id: 'city-1', name: 'Renamed City' }));
    expect(result.current).toMatchObject({ city: { name: 'Renamed City' }, street: 'Main', streetNumber: '5' });
  });

  it('clears street and number when city changes or is cleared', () => {
    const { result } = renderHook(() => useAddressStateWithCityReset({ city: { id: 'city-1', name: 'City One' }, street: 'Main', streetNumber: '5' }));
    act(() => result.current.setCity({ id: 'city-2', name: 'City Two' }));
    expect(result.current).toMatchObject({ street: '', streetNumber: '' });
    act(() => { result.current.setStreet('Oak'); result.current.setStreetNumber('9'); });
    act(() => result.current.setCity(null));
    expect(result.current).toMatchObject({ city: null, street: '', streetNumber: '' });
  });

  it('defaults missing initial fields and allows setters to update them', () => {
    const { result } = renderHook(() => useAddressStateWithCityReset({}));
    expect(result.current).toMatchObject({ city: null, street: '', streetNumber: '' });
    act(() => { result.current.setStreet('Pine'); result.current.setStreetNumber('2'); });
    expect(result.current).toMatchObject({ street: 'Pine', streetNumber: '2' });
  });
});
