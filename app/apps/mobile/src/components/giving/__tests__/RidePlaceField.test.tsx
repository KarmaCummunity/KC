// @vitest-environment jsdom
// G45 / D71 — a ride place is a catalog city or junction; a city may narrow to an official
// street (strict list, no free text), pinned at the city's coordinates.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';
import type { RidePlace } from '@kc/domain';

const TLV: RidePlace = { kind: 'city', id: '5000', label: 'תל אביב - יפו', lat: 32.08, lng: 34.78, cityId: '5000' };
const GLILOT: RidePlace = { kind: 'junction', id: '106', label: 'מחלף גלילות מערב', lat: 32.14, lng: 34.8, cityId: null };
const streetProps = vi.fn();

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'he' } }) }));
// Each picker is one button selecting a fixed row, so the test drives the field's own logic.
vi.mock('../../SearchablePicker/SearchablePicker', () => ({
  SearchablePicker: ({ onSelect }: { onSelect: (s: { id: string; name: string }) => void }) => (
    <button data-testid="pick-place" onClick={() => onSelect({ id: 'junction:106', name: 'x' })} />
  ),
}));
vi.mock('../../StreetPicker', () => ({
  StreetPicker: (props: { onChange: (s: { id: string; name: string }) => void; allowFreeText: boolean }) => {
    streetProps(props);
    return <button data-testid="pick-street" onClick={() => props.onChange({ id: '404', name: 'דיזנגוף' })} />;
  },
}));

import { RidePlaceField } from '../RidePlaceField';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderField(value: RidePlace | null, onChange = vi.fn()) {
  const view = render(
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
      <RidePlaceField label="From" value={value} places={[TLV, GLILOT]} isLoading={false} error={null} onChange={onChange} />
    </ThemeProvider>,
  );
  return { view, onChange };
}

describe('RidePlaceField', () => {
  it('picks a catalog place by kind and id', () => {
    const { view, onChange } = renderField(null);
    fireEvent.click(view.getByTestId('pick-place'));
    expect(onChange).toHaveBeenCalledWith(GLILOT);
  });

  it('offers a strict street step for a city and builds the street place', () => {
    const { view, onChange } = renderField(TLV);
    expect(streetProps).toHaveBeenCalledWith(expect.objectContaining({ cityId: '5000', allowFreeText: false }));

    fireEvent.click(view.getByTestId('pick-street'));
    expect(onChange).toHaveBeenCalledWith({
      kind: 'street', id: '5000:404', label: 'דיזנגוף, תל אביב - יפו', lat: 32.08, lng: 34.78, cityId: '5000',
    });
  });

  it('shows the street of a street place under its city', () => {
    renderField({ kind: 'street', id: '5000:404', label: 'דיזנגוף, תל אביב - יפו', lat: 32.08, lng: 34.78, cityId: '5000' });
    expect(streetProps).toHaveBeenCalledWith(expect.objectContaining({ value: { id: '404', name: 'דיזנגוף' } }));
  });

  it('has no street step for a junction', () => {
    const { view } = renderField(GLILOT);
    expect(view.queryByTestId('pick-street')).toBeNull();
  });
});
