// @vitest-environment jsdom
// Compact row variant of the base card: tone × status, slots, and the chat-preview contract
// (short preview + "open full post" link, never the post body).
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ThemeProvider, Text } from '@kc/ui';

vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('../../ui/KCImage', () => ({ KCImage: () => <span data-testid="thumb-image" /> }));

import { KcRowCard } from '../KcRowCard';

afterEach(cleanup);

const withTheme = (ui: React.ReactElement) =>
  render(<ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>{ui}</ThemeProvider>);

describe('KcRowCard', () => {
  it.each([
    ['give', false],
    ['give', true],
    ['request', false],
    ['request', true],
  ] as const)('tone=%s closed=%s keeps the shared structure', (tone, closed) => {
    const { getByTestId, queryByTestId, getByText } = withTheme(
      <KcRowCard title="ספה" tone={tone} badgeLabel={tone} placeholderIcon="gift-outline" closed={closed} closedLabel="closed" />,
    );
    expect(getByTestId('kc-row-card')).toBeTruthy();
    expect(getByText(tone)).toBeTruthy();
    expect(getByText('ספה')).toBeTruthy();
    expect(Boolean(queryByTestId('kc-row-closed'))).toBe(closed);
  });

  it('renders meta lines (skipping empty), status chip, trailing and footer slots', () => {
    const { getByText, getByTestId } = withTheme(
      <KcRowCard
        title="משמרת"
        tone="give"
        placeholderIcon="time-outline"
        meta={['10:00', null, '', 'תל אביב']}
        statusLabel="registered"
        trailing={<Text>cta</Text>}
        footer={<Text>cancel</Text>}
      />,
    );
    for (const s of ['10:00', 'תל אביב', 'cta', 'cancel']) expect(getByText(s)).toBeTruthy();
    expect(getByTestId('kc-row-status').textContent).toBe('registered');
  });

  it('chat preview: thumbnail + type + title + open-full-post link, tap opens the post, no body', () => {
    const onPress = vi.fn();
    const { getByTestId, getByText, queryByText } = withTheme(
      <KcRowCard
        testID="chat-anchored-post"
        title="שולחן אוכל"
        tone="request"
        badgeLabel="בקשה"
        placeholderIcon="search-outline"
        imageUri="https://x/y.jpg"
        openLinkLabel="לפוסט המלא"
        onPress={onPress}
      />,
    );
    expect(getByTestId('thumb-image')).toBeTruthy();
    expect(getByText('בקשה')).toBeTruthy();
    expect(getByTestId('kc-row-open-link').textContent).toContain('לפוסט המלא');
    expect(queryByText(/description/)).toBeNull();
    fireEvent.click(getByTestId('chat-anchored-post'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('is not pressable without onPress and hides the link when not requested', () => {
    const { getByTestId, queryByTestId } = withTheme(<KcRowCard title="x" tone="give" placeholderIcon="gift-outline" />);
    expect(queryByTestId('kc-row-open-link')).toBeNull();
    expect(getByTestId('kc-row-card')).toBeTruthy();
  });

  it('re-renders correctly when props update (memoization preserves updates)', () => {
    const { getByText, queryByText, rerender } = render(
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <KcRowCard title="Original Title" tone="give" placeholderIcon="gift-outline" statusLabel="active" />
      </ThemeProvider>,
    );
    expect(getByText('Original Title')).toBeTruthy();
    expect(getByText('active')).toBeTruthy();

    rerender(
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <KcRowCard title="Updated Title" tone="give" placeholderIcon="gift-outline" statusLabel="paused" />
      </ThemeProvider>,
    );
    expect(queryByText('Original Title')).toBeNull();
    expect(getByText('Updated Title')).toBeTruthy();
    expect(getByText('paused')).toBeTruthy();
  });
});
