// @vitest-environment jsdom
// Mapped to spec: FR-IMPORT-007 AC3 — the detail header shows the provenance chip of an imported
// post next to its type and category chips; a post made in KC has none.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import { PostDetailHeader } from '../PostDetailHeader';

afterEach(cleanup);

function renderHeader(provenance?: string | null) {
  return render(
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
      <PostDetailHeader title="Sofa" tone="give" badgeLabel="give" chip="Furniture" provenance={provenance} />
    </ThemeProvider>,
  );
}

describe('PostDetailHeader provenance', () => {
  it('shows the chip with the words it is given', () => {
    const view = renderHeader('From WhatsApp');
    expect(view.getByTestId('post-detail-provenance').textContent).toBe('From WhatsApp');
    expect(view.getByText('Furniture')).toBeTruthy();
  });

  it('shows no chip for a post made in KC', () => {
    expect(renderHeader(null).queryByTestId('post-detail-provenance')).toBeNull();
    cleanup();
    expect(renderHeader().queryByTestId('post-detail-provenance')).toBeNull();
  });
});
