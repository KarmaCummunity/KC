// @vitest-environment jsdom
// FR-POST-001 AC6 — the "− n +" stepper stays within its bounds.
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@kc/ui';

vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import { CountStepper } from '../CountStepper';

function renderStepper(value: number) {
  const onChange = vi.fn();
  render(
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
      <CountStepper value={value} min={1} max={3} onChange={onChange} label="seats" />
    </ThemeProvider>,
  );
  return onChange;
}

afterEach(() => cleanup());

describe('CountStepper', () => {
  it('steps up and down by one', () => {
    const onChange = renderStepper(2);
    fireEvent.click(screen.getByTestId('count-inc'));
    fireEvent.click(screen.getByTestId('count-dec'));
    expect(onChange.mock.calls).toEqual([[3], [1]]);
  });

  it('cannot go below the minimum or above the maximum', () => {
    const atMin = renderStepper(1);
    fireEvent.click(screen.getByTestId('count-dec'));
    expect(atMin).not.toHaveBeenCalled();
    cleanup();
    const atMax = renderStepper(3);
    fireEvent.click(screen.getByTestId('count-inc'));
    expect(atMax).not.toHaveBeenCalled();
  });
});
