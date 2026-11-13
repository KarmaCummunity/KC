// @vitest-environment jsdom
// FR-RESP-006 AC25 — the shared form section: label, required star, error, and the scope hookup
// that makes a rejected submit jump to it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { Text, ThemeProvider } from '@kc/ui';
import { FormScopeContext, type FormScopeValue } from '../formScope';
import { FormSection } from '../FormSection';

afterEach(cleanup);

function fakeScope() {
  const register = vi.fn(() => () => {});
  const setInvalid = vi.fn();
  const scope = {
    multiField: true,
    canGoNext: true,
    accessoryId: 'x',
    scrollProps: {},
    register,
    setInvalid,
    notifyFocus: vi.fn(),
    notifyBlur: vi.fn(),
    scrollToFirstInvalid: vi.fn(),
    submitEditing: vi.fn(),
  } as unknown as FormScopeValue;
  return { scope, register, setInvalid };
}

const themed = (ui: React.ReactElement, scope?: FormScopeValue) =>
  render(
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
      <FormScopeContext.Provider value={scope ?? null}>{ui}</FormScopeContext.Provider>
    </ThemeProvider>,
  );

describe('FormSection', () => {
  it('renders the label with the required star, the hint and the control', () => {
    const { getByText } = themed(
      <FormSection label="Category" required hint="Pick one">
        <Text>control</Text>
      </FormSection>,
    );
    expect(getByText('Category').textContent).toContain('*');
    expect(getByText('Pick one')).toBeTruthy();
    expect(getByText('control')).toBeTruthy();
  });

  it('shows the error as an alert under the control, and none when fine', () => {
    const bad = themed(
      <FormSection label="City" error="Choose a city">
        <Text>control</Text>
      </FormSection>,
    );
    expect(bad.getByRole('alert').textContent).toBe('Choose a city');
    bad.unmount();
    const ok = themed(
      <FormSection label="City">
        <Text>control</Text>
      </FormSection>,
    );
    expect(ok.queryByRole('alert')).toBeNull();
  });

  it('registers with the form scope and reports its error, so a rejected submit jumps to it', () => {
    const { scope, register, setInvalid } = fakeScope();
    const view = themed(
      <FormSection label="Photo">
        <Text>control</Text>
      </FormSection>,
      scope,
    );
    expect(register).toHaveBeenCalledTimes(1);
    // First render: no error, and the mount itself must not scroll.
    expect(setInvalid).toHaveBeenLastCalledWith(expect.any(String), false, false);

    view.rerender(
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <FormScopeContext.Provider value={scope}>
          <FormSection label="Photo" error="Add a photo">
            <Text>control</Text>
          </FormSection>
        </FormScopeContext.Provider>
      </ThemeProvider>,
    );
    expect(setInvalid).toHaveBeenLastCalledWith(expect.any(String), true, true);
  });

  it('is inert outside a form scope', () => {
    const { getByText } = themed(
      <FormSection label="Solo">
        <Text>control</Text>
      </FormSection>,
    );
    expect(getByText('control')).toBeTruthy();
  });
});
