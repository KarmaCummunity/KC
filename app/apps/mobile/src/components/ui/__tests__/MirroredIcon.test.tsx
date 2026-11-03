// @vitest-environment jsdom
// Spec 17 §4.2 / FR-RESP-006 AC4 + AC18 (#1288): a directional glyph is named for LTR and flips
// only when the layout runs RTL; the "back" glyph follows the platform.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render } from '@testing-library/react';

const { layout, platform } = vi.hoisted(() => ({ layout: { rtl: true }, platform: { os: 'web' } }));

vi.mock('../../../lib/rtlLayout', () => ({ isLayoutRtl: () => layout.rtl }));
vi.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name, style }: { name: string; style?: unknown }) => (
    <span data-testid={`icon-${name}`} data-style={JSON.stringify(style)} />
  ),
}));
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-native')>();
  return { ...actual, Platform: { ...actual.Platform, get OS() { return platform.os; } } };
});

import { MirroredIcon, useDirectionalBackIcon } from '../MirroredIcon';

afterEach(() => {
  cleanup();
  layout.rtl = true;
  platform.os = 'web';
});

/** The flattened style the icon double received. */
const styleOf = (el: HTMLElement) => JSON.stringify(JSON.parse(el.getAttribute('data-style') ?? 'null'));

describe('MirroredIcon', () => {
  it('flips the glyph horizontally when the layout runs RTL', () => {
    const { getByTestId } = render(<MirroredIcon name="chevron-forward" size={16} />);
    expect(styleOf(getByTestId('icon-chevron-forward'))).toContain('"scaleX":-1');
  });

  it('leaves the glyph alone in LTR and keeps the caller style', () => {
    layout.rtl = false;
    const { getByTestId } = render(<MirroredIcon name="arrow-back" size={16} style={{ opacity: 0.5 }} />);
    const style = styleOf(getByTestId('icon-arrow-back'));
    expect(style).not.toContain('scaleX');
    expect(style).toContain('"opacity":0.5');
  });
});

describe('useDirectionalBackIcon', () => {
  it.each([
    ['ios', 'chevron-back'],
    ['android', 'arrow-back'],
    ['web', 'arrow-back'],
  ])('names the %s back glyph for LTR', (os, expected) => {
    platform.os = os;
    expect(useDirectionalBackIcon()).toBe(expected);
  });
});
