// @vitest-environment jsdom
// D9 — a link that is not approved yet carries a status line: "waiting for approval" while
// pending, "not approved" (with the reviewer's note when given) after a rejection. An approved
// link, the only kind other members receive, has none.
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import type { DonationLink } from '@kc/domain';

vi.mock('react-i18next', async () => (await import('../ui/__tests__/kitDialogTestKit')).i18nDouble);
vi.mock('@expo/vector-icons', async () => (await import('../ui/__tests__/kitDialogTestKit')).iconsDouble);
vi.mock('../../utils/openExternalUrl', () => ({ openExternalUrl: vi.fn() }));

import { renderInTheme } from '../ui/__tests__/kitDialogTestKit';
import { DonationLinkRow } from '../DonationLinkRow';

afterEach(cleanup);

const BASE: DonationLink = {
  id: 'l_1',
  categorySlug: 'food',
  url: 'https://example.org',
  displayName: 'Example NGO',
  description: null,
  submittedBy: 'u_owner',
  validatedAt: '2026-11-03T00:00:00.000Z',
  createdAt: '2026-11-03T00:00:00.000Z',
  reviewStatus: 'approved',
  reviewNote: null,
};

function statusLine(link: DonationLink): string | null {
  renderInTheme(<DonationLinkRow link={link} canRemove onMenuPress={vi.fn()} />);
  return screen.queryByTestId(`donation-link-review-${link.id}`)?.textContent ?? null;
}

describe('DonationLinkRow review status (D9)', () => {
  it('says the link waits for approval while pending', () => {
    expect(statusLine({ ...BASE, reviewStatus: 'pending' })).toBe('donations.links.reviewPending');
  });

  it('says it was not approved, with the note when the reviewer left one', () => {
    expect(statusLine({ ...BASE, reviewStatus: 'rejected' })).toBe('donations.links.reviewRejected');
    cleanup();
    expect(statusLine({ ...BASE, reviewStatus: 'rejected', reviewNote: 'not an org' })).toContain(
      'donations.links.reviewRejectedNote',
    );
  });

  it('shows no status line on an approved link', () => {
    expect(statusLine(BASE)).toBeNull();
  });
});
