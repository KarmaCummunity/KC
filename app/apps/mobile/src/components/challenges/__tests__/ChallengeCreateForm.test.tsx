// @vitest-environment jsdom
// docs/spec/10_challenges.md / FR-RESP-006 AC29 — a refused challenge is marked on its field and is
// not sent; once fixed, the draft goes to `onSubmit`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';

vi.mock('react-native-reanimated', async () => (await import('../../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('react-native-safe-area-context', async () => (await import('../../ui/__tests__/kitDialogTestKit')).safeAreaDouble);
vi.mock('react-i18next', async () => (await import('../../ui/__tests__/kitDialogTestKit')).i18nDouble);
vi.mock('@expo/vector-icons', async () => (await import('../../ui/__tests__/kitDialogTestKit')).iconsDouble);
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));

import { renderInTheme } from '../../ui/__tests__/kitDialogTestKit';
import { ChallengeCreateForm } from '../ChallengeCreateForm';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderForm() {
  const onSubmit = vi.fn();
  renderInTheme(
    <ChallengeCreateForm busy={false} errorMessage={null} onSubmit={onSubmit} onPublishActionChange={() => undefined} />,
  );
  return { onSubmit };
}

describe('ChallengeCreateForm', () => {
  it('marks a too-short title under the title and sends nothing, then sends the fixed draft', () => {
    const { onSubmit } = renderForm();
    const title = screen.getByTestId('challenge-form-title');
    fireEvent.click(screen.getByTestId('challenge-form-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(title.getAttribute('aria-label')).toBe('challenges.form.title, challenges.errors.title_too_short');

    fireEvent.change(title, { target: { value: 'Walk every day' } });
    expect(title.getAttribute('aria-label')).toBe('challenges.form.title');
    fireEvent.click(screen.getByTestId('challenge-form-submit'));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ title: 'Walk every day' }));
  });

  it("shows the server's refusal at the end of the form", () => {
    renderInTheme(
      <ChallengeCreateForm busy={false} errorMessage="server said no" onSubmit={vi.fn()} onPublishActionChange={() => undefined} />,
    );
    expect(screen.getByText('server said no')).toBeTruthy();
  });
});
