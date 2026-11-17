// @vitest-environment jsdom
// FR-RESP-006 AC27 — a repeated rejected submit with unchanged errors still jumps: `FormScreen` and
// `FormScrollView` both take `jumpToProblemSignal`, rendered through `JumpOnSignal`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { FormScopeContext, type FormScopeValue } from '../formScope';
import { JumpOnSignal } from '../FormScope';

afterEach(cleanup);

function renderWithScope(signal: number, scrollToFirstInvalid: () => void) {
  const scope = { scrollToFirstInvalid } as unknown as FormScopeValue;
  return render(
    <FormScopeContext.Provider value={scope}>
      <JumpOnSignal signal={signal} />
    </FormScopeContext.Provider>,
  );
}

describe('JumpOnSignal', () => {
  it('does not jump on mount, then jumps once per bump', () => {
    const jump = vi.fn();
    const view = renderWithScope(0, jump);
    expect(jump).not.toHaveBeenCalled();

    const rerender = (signal: number) =>
      view.rerender(
        <FormScopeContext.Provider value={{ scrollToFirstInvalid: jump } as unknown as FormScopeValue}>
          <JumpOnSignal signal={signal} />
        </FormScopeContext.Provider>,
      );
    rerender(1);
    rerender(1);
    rerender(2);
    expect(jump).toHaveBeenCalledTimes(2);
  });
});
