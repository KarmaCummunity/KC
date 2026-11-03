// @vitest-environment jsdom
// Base post card variants: tone (give/request) × status (open/closed) × size (full/compact) + slots.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { ThemeProvider, Text } from '@kc/ui';

vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('../../ui/KCImage', () => ({ KCImage: () => null }));
vi.mock('../../AvatarInitials', () => ({ AvatarInitials: () => null }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'he' } }) }));

import { KcCard, type KcCardProps } from '../KcCard';
import { PostDetailHeader } from '../PostDetailHeader';

afterEach(cleanup);

const base: KcCardProps = {
  width: 180,
  onPress: () => {},
  placeholderIcon: 'gift-outline',
  tone: 'give',
  badgeLabel: 'give',
  title: 'ספה',
};

function withTheme(ui: React.ReactElement) {
  return render(<ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>{ui}</ThemeProvider>);
}

describe('KcCard variants', () => {
  it.each([
    ['give', false, false],
    ['give', true, false],
    ['request', false, false],
    ['request', true, true],
  ] as const)('tone=%s closed=%s dense=%s renders the shared structure', (tone, closed, dense) => {
    const { getByTestId, queryByTestId, getByText } = withTheme(
      <KcCard {...base} tone={tone} badgeLabel={tone} closed={closed} closedLabel="closed" dense={dense} chip="chip" />,
    );
    expect(getByTestId('kc-post-card')).toBeTruthy();
    expect(getByText(tone)).toBeTruthy();
    expect(getByText('ספה')).toBeTruthy();
    expect(getByText('chip')).toBeTruthy();
    expect(Boolean(queryByTestId('kc-card-closed'))).toBe(closed);
  });

  it('match variant: status slot + footer slot', () => {
    const { getByTestId, getByText } = withTheme(
      <KcCard {...base} testID="match-card-1" statusLabel="waiting · 65%" footer={<Text>accept</Text>} />,
    );
    expect(getByTestId('match-card-1')).toBeTruthy();
    expect(getByTestId('kc-card-status').textContent).toBe('waiting · 65%');
    expect(getByText('accept')).toBeTruthy();
  });

  it('renders author, route, details and footer meta', () => {
    const { getByText } = withTheme(
      <KcCard
        {...base}
        author={{ name: 'הדר' }}
        route={{ from: 'A', to: 'B' }}
        details={[{ icon: 'time-outline', text: '10:00' }]}
        location="תל אביב"
        timeAgo="לפני שעה"
      />,
    );
    for (const s of ['הדר', 'A', 'B', '10:00', 'תל אביב', 'לפני שעה']) expect(getByText(s)).toBeTruthy();
  });
});

describe('PostDetailHeader (same design language as the card)', () => {
  it.each(['give', 'request'] as const)('%s header shows type pill, chip and clean title', (tone) => {
    const { getByText, queryByTestId } = withTheme(
      <PostDetailHeader title="[e2e] ספה" tone={tone} badgeLabel={tone} chip="חפצים" />,
    );
    expect(getByText(tone)).toBeTruthy();
    expect(getByText('חפצים')).toBeTruthy();
    expect(getByText('ספה')).toBeTruthy();
    expect(queryByTestId('post-detail-closed')).toBeNull();
  });
  it('closed header shows the closed chip', () => {
    const { getByTestId } = withTheme(<PostDetailHeader title="x" tone="give" badgeLabel="g" closed />);
    expect(getByTestId('post-detail-closed')).toBeTruthy();
  });
});
