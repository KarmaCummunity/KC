// #1632: every world stack keeps the shared TopBar (KC logo) in its header.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../components/TopBar', () => ({ TopBar: () => null }));
vi.mock('../../components/BackButton', () => ({ BackButton: () => null }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: () => null }));
vi.mock('@kc/ui', () => ({
  makeUseStyles: () => () => ({}),
  spacing: {},
  typography: {},
  useTheme: () => ({ colors: {} }),
  Text: () => null,
}));

import {
  resolveStackHeaderTitle,
  resolveTopBarCenterTitle,
  stackOptionsForShellTopBarTitle,
  topBarStackHeaderOptions,
} from '../TopBarStackHeader';

const donationsDir = join(__dirname, '../../../app/(tabs)/donations');
const read = (rel: string) => readFileSync(join(donationsDir, rel), 'utf8');

describe('TopBar stack header (#1632)', () => {
  it('uses a string headerTitle, else falls back to title', () => {
    expect(resolveStackHeaderTitle({ headerTitle: 'Rides' })).toBe('Rides');
    expect(resolveStackHeaderTitle({ headerTitle: () => null, title: 'T' })).toBe('T');
    expect(resolveStackHeaderTitle({})).toBeUndefined();
  });

  it('resolveTopBarCenterTitle prefers function and element slots over plain title', () => {
    expect(resolveTopBarCenterTitle({ headerTitle: 'Food' })).toBe('Food');
    expect(
      resolveTopBarCenterTitle({
        headerTitle: ({ children }) => `fn:${children}`,
        title: 'ignored',
      }),
    ).toBe('fn:ignored');
    const node = { type: 'span', props: {} } as unknown as React.ReactElement;
    expect(resolveTopBarCenterTitle({ headerTitle: node, title: 'x' })).toBe(node);
  });

  it('stackOptionsForShellTopBarTitle maps strings vs custom nodes', () => {
    expect(stackOptionsForShellTopBarTitle('הגדרות')).toEqual({
      title: 'הגדרות',
      headerTitle: 'הגדרות',
    });
    const menu = { type: 'button' } as unknown as React.ReactElement;
    const opts = stackOptionsForShellTopBarTitle(menu);
    expect(opts.title).toBe('');
    expect(typeof opts.headerTitle).toBe('function');
    expect((opts.headerTitle as () => unknown)()).toBe(menu);
  });

  it('options turn the header on with the shared renderer', () => {
    expect(topBarStackHeaderOptions.headerShown).toBe(true);
    expect(typeof topBarStackHeaderOptions.header).toBe('function');
  });

  it.each(['food', 'housing', 'items', 'time', 'money'])('%s world stack uses the TopBar header', (w) => {
    expect(read(`${w}/_layout.tsx`)).toContain('...topBarStackHeaderOptions');
  });

  it('rides / knowledge (world stack options) and the donations stack use it', () => {
    const opts = readFileSync(join(__dirname, '../worldStackOptions.ts'), 'utf8');
    expect(opts).toContain('header: topBarStackHeader');
    expect(read('_layout.tsx')).toContain('header: topBarStackHeader');
  });
});
