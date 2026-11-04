// @vitest-environment jsdom
// FR-POST-001 AC6 — a world with several kinds per direction asks which one the member means.
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@kc/ui';
import { KINDS_BY_WORLD } from '../../../lib/unifiedCreate/__tests__/listingKindFixtures';

vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }) }));

import { ListingKindChooser } from '../ListingKindChooser';

const animals = KINDS_BY_WORLD.animals!;
const give = animals.filter((k) => k.direction === 'give');

function renderChooser(props: Partial<React.ComponentProps<typeof ListingKindChooser>> = {}) {
  const onChoose = vi.fn();
  render(
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
      <ListingKindChooser choices={give} selectedKindId={give[0]!.kindId} onChoose={onChoose} {...props} />
    </ThemeProvider>,
  );
  return onChoose;
}

afterEach(cleanup);

describe('ListingKindChooser', () => {
  it('shows one chip per kind with the selected one checked', () => {
    renderChooser();
    expect(screen.getByTestId('listing-kind-adoption_offer').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('listing-kind-foster_offer').getAttribute('aria-checked')).toBe('false');
  });

  it('reports the kind the member taps', () => {
    const onChoose = renderChooser();
    fireEvent.click(screen.getByTestId('listing-kind-foster_offer'));
    expect(onChoose).toHaveBeenCalledWith('foster_offer');
  });

  it('renders nothing when there is nothing to choose between', () => {
    renderChooser({ choices: [give[0]!] });
    expect(screen.queryByTestId('listing-kind-chooser')).toBeNull();
  });
});
