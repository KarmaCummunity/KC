// @vitest-environment jsdom
// FR-MOD-010 / KC#1298 — the owner's support-thread notice follows the payload outcome:
// hidden for review (posts 0452, listings 0468) vs removed outright (notices sent before 0452).
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'he' } }) }));

import { OwnerAutoRemovedBubble } from '../OwnerAutoRemovedBubble';

afterEach(cleanup);

function renderBubble(payload: Record<string, unknown> | null) {
  return render(
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
      <OwnerAutoRemovedBubble messageId="m1" payload={payload} body="" createdAt="2026-10-30T00:00:00Z" handledByLaterAction={false} />
    </ThemeProvider>,
  );
}

describe('OwnerAutoRemovedBubble', () => {
  it.each(['post', 'listing'])('tells the owner a reported %s is hidden for review', (targetType) => {
    const { getByText, queryByText } = renderBubble({
      kind: 'owner_auto_removed',
      target_type: targetType,
      target_id: 't1',
      outcome: 'hidden_pending_review',
    });
    expect(getByText('moderation.bubble.ownerHiddenForReview.body')).toBeTruthy();
    expect(queryByText('moderation.bubble.ownerAutoRemoved.body')).toBeNull();
  });

  it('keeps the removal notice for notices without an outcome', () => {
    const { getByText } = renderBubble({ kind: 'owner_auto_removed', target_type: 'post', target_id: 't1' });
    expect(getByText('moderation.bubble.ownerAutoRemoved.body')).toBeTruthy();
  });
});
