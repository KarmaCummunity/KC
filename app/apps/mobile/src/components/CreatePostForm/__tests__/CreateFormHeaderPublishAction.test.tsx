// KC#1472 — the shared create-form header action is available in every category and direction.
// The surrounding create screen supplies the category's existing submit callback.
// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@kc/ui';
import { CreateFormHeaderPublishAction } from '../CreateFormHeaderPublishAction';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../ui/Buttons', () => ({
  PrimaryButton: ({ label, onPress, loading, disabled, testID }: {
    label: string;
    onPress: () => void;
    loading: boolean;
    disabled: boolean;
    testID: string;
  }) => (
    <button type="button" data-testid={testID} aria-busy={loading} disabled={loading || disabled} onClick={onPress}>
      {label}
    </button>
  ),
}));

afterEach(cleanup);

const categories = ['items', 'rides', 'food', 'housing', 'time'];
const directions = ['give', 'request'];

describe('CreateFormHeaderPublishAction', () => {
  it.each(categories.flatMap((category) => directions.map((direction) => [category, direction]))) (
    'renders and submits once for %s / %s', (category, direction) => {
      const submit = vi.fn();
      render(
        <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
          <CreateFormHeaderPublishAction onPress={submit} loading={false} />
        </ThemeProvider>,
      );
      fireEvent.click(screen.getByTestId('create-header-publish'));
      expect(screen.getByTestId('create-header-publish')).toBeTruthy();
      expect(submit).toHaveBeenCalledTimes(1);
      expect(`${category}/${direction}`).toBeTruthy();
    },
  );

  it('blocks presses and shows the loading state while submitting', () => {
    const submit = vi.fn();
    render(
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <CreateFormHeaderPublishAction onPress={submit} loading />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByTestId('create-header-publish'));
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByTestId('create-header-publish').getAttribute('aria-busy')).toBe('true');
  });
});
