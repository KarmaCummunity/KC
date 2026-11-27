// @vitest-environment jsdom
// FR-SETTINGS-010 / #1789 — in-house markdown-it legal renderer.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ThemeProvider, lightColors } from '@kc/ui';

const openExternalUrl = vi.fn();
vi.mock('../../../utils/openExternalUrl', () => ({
  openExternalUrl: (...args: unknown[]) => openExternalUrl(...args),
}));

import { LegalMarkdown } from '../LegalMarkdown';

afterEach(() => {
  cleanup();
  openExternalUrl.mockReset();
});

const wrap = (md: string) =>
  render(
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
      <LegalMarkdown colors={lightColors}>{md}</LegalMarkdown>
    </ThemeProvider>,
  );

describe('LegalMarkdown', () => {
  it('renders headings, paragraphs, bold, italic, lists, blockquote and hr', () => {
    const { getByRole, getByText, getAllByText, getByTestId } = wrap(
      [
        '# Title',
        '',
        'Hello **bold** and *italic*.',
        '',
        '- bullet one',
        '- bullet two',
        '',
        '1. first',
        '',
        '> quoted',
        '',
        '---',
        '',
      ].join('\n'),
    );

    expect(getByRole('heading', { name: 'Title' })).toBeTruthy();
    expect(getByText('bold')).toBeTruthy();
    expect(getByText('italic')).toBeTruthy();
    expect(getAllByText('•')).toHaveLength(2);
    expect(getByText('1.')).toBeTruthy();
    expect(getByText('quoted')).toBeTruthy();
    expect(getByTestId('legal-md-hr')).toBeTruthy();
  });

  it('opens only safe http(s)/mailto links via openExternalUrl', () => {
    const { getByRole } = wrap('[safe](https://example.com/a) and [mail](mailto:a@b.co)');
    fireEvent.click(getByRole('link', { name: 'safe' }));
    expect(openExternalUrl).toHaveBeenCalledWith('https://example.com/a');
    fireEvent.click(getByRole('link', { name: 'mail' }));
    expect(openExternalUrl).toHaveBeenCalledWith('mailto:a@b.co');
  });

  it('does not emit a link for javascript: URLs (markdown-it validateLink)', () => {
    const { queryByRole, getByText } = wrap('[bad](javascript:void0)');
    expect(queryByRole('link')).toBeNull();
    expect(getByText('[bad](javascript:void0)')).toBeTruthy();
  });

  it('swallows openExternalUrl errors so a rejected scheme cannot crash the reader', () => {
    openExternalUrl.mockImplementation(() => {
      throw new Error('unsupported_scheme');
    });
    const { getByRole } = wrap('[x](https://example.com)');
    expect(() => fireEvent.click(getByRole('link', { name: 'x' }))).not.toThrow();
  });

  it('linkifies bare https URLs used in legal copy', () => {
    const { getByRole } = wrap('see https://www.gov.il/he/departments/x');
    fireEvent.click(getByRole('link', { name: 'https://www.gov.il/he/departments/x' }));
    expect(openExternalUrl).toHaveBeenCalledWith('https://www.gov.il/he/departments/x');
  });
});
