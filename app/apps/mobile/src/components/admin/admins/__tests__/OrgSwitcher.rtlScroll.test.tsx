// @vitest-environment jsdom
// #1747 — OrgSwitcher wires the shared RTL-web horizontal scroll-start helper
// so the first org chip is on-screen when the row overflows.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';
import type { ScrollViewProps } from 'react-native';

const platform = vi.hoisted(() => ({ OS: 'web' as 'web' | 'ios' | 'android' }));
const layoutRtl = vi.hoisted(() => ({ current: true }));
const captured: { props: ScrollViewProps | null } = { props: null };
const scrollToEnd = vi.fn();

vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-native')>();
  const ScrollView = React.forwardRef(function MockScrollView(
    props: ScrollViewProps,
    ref: React.Ref<{ scrollToEnd: typeof scrollToEnd }>,
  ) {
    captured.props = props;
    React.useImperativeHandle(ref, () => ({ scrollToEnd }));
    return <div data-testid="org-switcher-scroll">{props.children}</div>;
  });
  return {
    ...actual,
    Platform: { get OS() { return platform.OS; } },
    ScrollView,
  };
});

vi.mock('../../../../lib/rtlLayout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/rtlLayout')>();
  return {
    ...actual,
    isLayoutRtl: () => layoutRtl.current,
    // Keep rowDirectionStart aligned with the mocked layout direction.
    get rowDirectionStart() {
      return platform.OS === 'web' && layoutRtl.current ? 'row-reverse' : 'row';
    },
  };
});

vi.mock('../../../../i18n/useLocaleBundle', async () => {
  const he = (await import('../../../../i18n/locales/he')).default;
  return { useLocaleBundle: () => he, localeBundle: () => he };
});

import { OrgSwitcher } from '../OrgSwitcher';

beforeEach(() => {
  platform.OS = 'web';
  layoutRtl.current = true;
  captured.props = null;
  scrollToEnd.mockClear();
});

afterEach(cleanup);

describe('OrgSwitcher RTL web scroll start (#1747)', () => {
  it('scrolls its horizontal ScrollView to the reading-start edge on RTL web', () => {
    render(
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <OrgSwitcher
          orgs={[{ id: 'o1', name: 'Alpha' }, { id: 'o2', name: 'Beta' }]}
          selected={null}
          onSelect={() => {}}
        />
      </ThemeProvider>,
    );
    expect(captured.props?.horizontal).toBe(true);
    captured.props?.onContentSizeChange?.(800, 40);
    expect(scrollToEnd).toHaveBeenCalledWith({ animated: false });
  });

  it('does not scroll on LTR web', () => {
    layoutRtl.current = false;
    render(
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <OrgSwitcher
          orgs={[{ id: 'o1', name: 'Alpha' }]}
          selected={null}
          onSelect={() => {}}
        />
      </ThemeProvider>,
    );
    captured.props?.onContentSizeChange?.(800, 40);
    expect(scrollToEnd).not.toHaveBeenCalled();
  });
});
