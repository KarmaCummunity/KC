// @vitest-environment jsdom
// FR-POST-001 AC6 / D100 — the create form of a world with no feed is "add a link": the submit
// is blocked until the link is valid, then writes to the world's links category and reports it.
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@kc/ui';

const mocks = vi.hoisted(() => ({ addLink: vi.fn() }));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'he' } }) }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('../../../lib/container', () => ({
  container: { addDonationLink: { execute: mocks.addLink }, updateDonationLink: { execute: vi.fn() } },
}));
// The kit buttons animate with reanimated and haptics; the shared test doubles stand in for both.
vi.mock('react-native-reanimated', async () => (await import('../../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('../../../navigation/useShellTabBarVisibility', () => ({ useShellTabBarScrollInset: () => 0 }));

import { LinkCreateForm } from '../LinkCreateForm';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderForm(onAdded = vi.fn(), onPublishActionChange = vi.fn()) {
  render(
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
      <LinkCreateForm
        categorySlug="democracy"
        header={<div data-testid="header" />}
        onAdded={onAdded}
        onPublishActionChange={onPublishActionChange}
      />
    </ThemeProvider>,
  );
  return { onAdded, onPublishActionChange };
}

// A field in error is named "label, message" for screen readers, so match by prefix.
const input = (label: string) => screen.getByLabelText(new RegExp(`^${label}`)) as HTMLInputElement;
const type = (label: string, value: string) => fireEvent.change(input(label), { target: { value } });

describe('LinkCreateForm', () => {
  it('marks the invalid fields next to them on a rejected submit, sends nothing, and clears them once fixed', async () => {
    const { onAdded } = renderForm();
    expect(screen.queryByRole('alert')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByTestId('link-publish'));
    });
    expect(screen.getByText('createPostValidation.linkUrlInvalid')).toBeTruthy();
    expect(screen.getByText('createPostValidation.linkNameShort')).toBeTruthy();
    expect(mocks.addLink).not.toHaveBeenCalled();
    expect(onAdded).not.toHaveBeenCalled();
    type('donations.addLinkModal.urlLabel', 'https://example.org');
    type('donations.addLinkModal.nameLabel', 'Example org');
    expect(screen.queryByText('createPostValidation.linkUrlInvalid')).toBeNull();
    expect(screen.queryByText('createPostValidation.linkNameShort')).toBeNull();
  });

  it('adds the link to the world\'s links category and reports it', async () => {
    const link = { id: 'l1' };
    mocks.addLink.mockResolvedValue(link);
    const { onAdded } = renderForm();
    type('donations.addLinkModal.urlLabel', 'https://example.org');
    type('donations.addLinkModal.nameLabel', 'Example org');
    await act(async () => {
      fireEvent.click(screen.getByTestId('link-publish'));
    });
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith(link));
    expect(mocks.addLink).toHaveBeenCalledWith({
      categorySlug: 'democracy',
      url: 'https://example.org',
      displayName: 'Example org',
      description: null,
    });
  });

  it('registers the header publish action and clears it on unmount', () => {
    const { onPublishActionChange } = renderForm();
    expect(onPublishActionChange).toHaveBeenCalledWith(expect.any(Function), false);
    cleanup();
    expect(onPublishActionChange).toHaveBeenLastCalledWith(null, false);
  });
});
