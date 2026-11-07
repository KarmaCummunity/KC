// @vitest-environment jsdom
// FR-VERIFY-001 AC2/AC3: one badge per level, nothing at level 0.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render } from '@testing-library/react';

const iconProps: Array<Record<string, unknown>> = [];

vi.mock('@expo/vector-icons', () => ({
  Ionicons: (props: Record<string, unknown>) => {
    iconProps.push(props);
    return <span data-testid={props.testID as string} />;
  },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@kc/ui', () => ({
  iconSize: { sm: 16 },
  useTheme: () => ({ colors: { success: 'green', info: 'blue', warning: 'gold' } }),
}));

import { VerificationBadge } from '../VerificationBadge';

afterEach(() => {
  cleanup();
  iconProps.length = 0;
});

describe('VerificationBadge', () => {
  it.each([0, undefined] as const)('renders nothing for level %s', (level) => {
    const { container } = render(<VerificationBadge level={level} />);
    expect(container.innerHTML).toBe('');
  });

  it.each([
    [1, 'green'],
    [2, 'blue'],
    [3, 'gold'],
  ] as const)('level %i uses its color and a level label', (level, color) => {
    const { getByTestId } = render(<VerificationBadge level={level} />);
    expect(getByTestId(`verification-badge-${level}`)).toBeTruthy();
    expect(iconProps[0]).toMatchObject({
      name: 'checkmark-circle',
      color,
      accessibilityLabel: `verification.level.${level}`,
    });
  });
});
