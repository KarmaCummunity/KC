// @vitest-environment jsdom
// Spec 07 §7.7 / KC#1106, KC#1114 — the handoff rating step: a star only selects, submit sends the
// rating with the optional (trimmed) note, and nothing is sent before a star is picked.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';

vi.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />,
}));
// The kit buttons pull in reanimated and haptics; their press feedback is not under test here.
vi.mock('react-native-reanimated', async () => (await import('../../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'he' } }) }));

import { HANDOFF_RATING_NOTE_MAX_LENGTH, HandoffRatingForm } from '../HandoffRatingForm';

afterEach(cleanup);

function renderForm(onSubmit = vi.fn(), busy = false) {
  const view = render(
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
      <HandoffRatingForm busy={busy} onSubmit={onSubmit} />
    </ThemeProvider>,
  );
  return { ...view, onSubmit };
}

describe('HandoffRatingForm', () => {
  it('sends nothing until a star is picked, and a star alone does not submit', () => {
    const { getByTestId, onSubmit } = renderForm();

    fireEvent.click(getByTestId('handoff-rating-submit'));
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(getByTestId('handoff-rating-star-4'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits the picked rating with the trimmed note', () => {
    const { getByTestId, onSubmit } = renderForm();

    fireEvent.click(getByTestId('handoff-rating-star-5'));
    fireEvent.change(getByTestId('handoff-rating-note'), { target: { value: '  Thank you, very kind!  ' } });
    fireEvent.click(getByTestId('handoff-rating-submit'));

    expect(onSubmit).toHaveBeenCalledWith(5, 'Thank you, very kind!');
  });

  it('sends a blank note as null', () => {
    const { getByTestId, onSubmit } = renderForm();

    fireEvent.click(getByTestId('handoff-rating-star-3'));
    fireEvent.change(getByTestId('handoff-rating-note'), { target: { value: '   ' } });
    fireEvent.click(getByTestId('handoff-rating-submit'));

    expect(onSubmit).toHaveBeenCalledWith(3, null);
  });

  it('caps the note length', () => {
    const { getByTestId } = renderForm();
    expect(getByTestId('handoff-rating-note').getAttribute('maxlength')).toBe(String(HANDOFF_RATING_NOTE_MAX_LENGTH));
  });

  it('does not submit while a previous action is in flight', () => {
    const { getByTestId, onSubmit } = renderForm(vi.fn(), true);

    fireEvent.click(getByTestId('handoff-rating-star-2'));
    fireEvent.click(getByTestId('handoff-rating-submit'));

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
