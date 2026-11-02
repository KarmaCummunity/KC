// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import { AgeConfirmationCheckbox } from '../AgeConfirmationCheckbox';

afterEach(cleanup);

const wrap = (ui: React.ReactElement) =>
  render(<ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>{ui}</ThemeProvider>);

describe('AgeConfirmationCheckbox', () => {
  it('renders a labelled checkbox and toggles on press', () => {
    const onToggle = vi.fn();
    const { getByRole } = wrap(<AgeConfirmationCheckbox checked={false} onToggle={onToggle} />);
    const box = getByRole('checkbox', { name: 'legal.checkboxAge18' });
    fireEvent.click(box);
    expect(onToggle).toHaveBeenCalledWith(true);
  });
});
