// @vitest-environment jsdom
// Mapped to spec: FR-IMPORT-007 AC2 — the notice above an imported draft: filled from the message,
// contact details removed, which fields to check; nothing without an import.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';

vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, v?: { fields?: string }) => (v?.fields ? `${k}:${v.fields}` : k) }),
}));

import { ImportReviewNotice } from '../ImportReviewNotice';
import { useImportDraftStore, type ImportReview } from '../../../store/importDraftStore';

const review = (over: Partial<ImportReview> = {}): ImportReview => ({ removedContacts: false, confirmFields: [], truncated: false, ...over });
const renderNotice = () =>
  render(
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
      <ImportReviewNotice />
    </ThemeProvider>,
  );

beforeEach(() => useImportDraftStore.setState({ review: null }));
afterEach(cleanup);

describe('ImportReviewNotice', () => {
  it('shows nothing on a form opened without an import', () => {
    expect(renderNotice().queryByTestId('import-review-notice')).toBeNull();
  });

  it('says the form was filled from the message, and nothing more when all is sure', () => {
    useImportDraftStore.setState({ review: review() });
    const view = renderNotice();
    expect(view.getByText('postImport.reviewTitle')).toBeTruthy();
    expect(view.queryByTestId('import-review-check')).toBeNull();
    expect(view.queryByTestId('import-review-removed')).toBeNull();
    expect(view.queryByTestId('import-review-truncated')).toBeNull();
  });

  it('lists the known fields to check and skips unknown names', () => {
    useImportDraftStore.setState({ review: review({ confirmFields: ['city', 'mystery', 'direction'] }) });
    const view = renderNotice();
    expect(view.getByTestId('import-review-check').textContent).toBe(
      'postImport.reviewCheck:postImport.fields.city, postImport.fields.direction',
    );
  });

  it('tells about removed contact details and a cut message', () => {
    useImportDraftStore.setState({ review: review({ removedContacts: true, truncated: true }) });
    const view = renderNotice();
    expect(view.getByTestId('import-review-removed')).toBeTruthy();
    expect(view.getByTestId('import-review-truncated')).toBeTruthy();
  });

  it('goes away when the form forgets the import', () => {
    useImportDraftStore.setState({ review: review() });
    const view = renderNotice();
    act(() => useImportDraftStore.getState().forget());
    expect(view.queryByTestId('import-review-notice')).toBeNull();
  });
});
