// #1632: every world stack keeps the shared TopBar (KC logo) in its header.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

import { resolveStackHeaderTitle, topBarStackHeaderOptions } from '../TopBarStackHeader';

const donationsDir = join(__dirname, '../../../app/(tabs)/donations');
const read = (rel: string) => readFileSync(join(donationsDir, rel), 'utf8');

describe('TopBar stack header (#1632)', () => {
  it('uses a string headerTitle, else falls back to title', () => {
    expect(resolveStackHeaderTitle({ headerTitle: 'Rides' })).toBe('Rides');
    expect(resolveStackHeaderTitle({ headerTitle: () => null, title: 'T' })).toBe('T');
    expect(resolveStackHeaderTitle({})).toBeUndefined();
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
