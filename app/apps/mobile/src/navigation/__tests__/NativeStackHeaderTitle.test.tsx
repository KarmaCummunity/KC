// @vitest-environment jsdom
import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NativeStackHeaderTitle } from '../NativeStackHeaderTitle';

vi.mock('@kc/ui', () => ({
  typography: { h4: {} },
  useTheme: () => ({ colors: { textPrimary: '#000' } }),
  Text: ({
    children,
    numberOfLines,
    ellipsizeMode,
  }: {
    children: React.ReactNode;
    numberOfLines: number;
    ellipsizeMode: string;
  }) => (
    <span data-number-of-lines={numberOfLines} data-ellipsize-mode={ellipsizeMode}>
      {children}
    </span>
  ),
}));

describe('NativeStackHeaderTitle', () => {
  it('keeps a long title on one ellipsized line', () => {
    const title = Array.from({ length: 8 }, () => 'Conversations').join(' ');
    const { getByText } = render(<NativeStackHeaderTitle title={title} />);
    const renderedTitle = getByText(title);

    expect(renderedTitle.getAttribute('data-number-of-lines')).toBe('1');
    expect(renderedTitle.getAttribute('data-ellipsize-mode')).toBe('tail');
  });
});
