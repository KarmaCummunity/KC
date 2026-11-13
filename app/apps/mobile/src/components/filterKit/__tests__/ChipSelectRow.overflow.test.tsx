// @vitest-environment jsdom
// The expand control appears only when the chips overflow the row, and still expands / collapses.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React, { useEffect } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';

vi.mock('@expo/vector-icons', () => ({ Ionicons: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} /> }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
// jsdom has no layout: report a 300px row holding 500px of chips.
vi.mock('react-native', async () => {
  const actual = await vi.importActual<typeof import('react-native')>('react-native');
  return {
    ...actual,
    ScrollView: ({ children, onLayout, onContentSizeChange }: {
      children?: React.ReactNode;
      onLayout?: (e: { nativeEvent: { layout: { width: number } } }) => void;
      onContentSizeChange?: (w: number, h: number) => void;
    }) => {
      useEffect(() => {
        onLayout?.({ nativeEvent: { layout: { width: 300 } } });
        onContentSizeChange?.(500, 40);
      }, [onLayout, onContentSizeChange]);
      return <div>{children}</div>;
    },
  };
});

import { ChipSelectRow } from '../ChipSelectRow';

afterEach(cleanup);

describe('ChipSelectRow with overflowing chips', () => {
  it('shows the expand control, expands and collapses', () => {
    render(
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <ChipSelectRow testID="chips">
          <span>A</span>
        </ChipSelectRow>
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByTestId('chips-expand'));
    fireEvent.click(screen.getByTestId('chips-collapse'));
    expect(screen.getByTestId('chips-expand')).toBeTruthy();
  });
});
