// @vitest-environment jsdom
// FR-RESP-006 AC25 — the shared primitives hand their forms the form scope, so a form needs no wiring.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';

vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('../AmbientBlobs', () => ({ AmbientBlobs: () => null }));
vi.mock('../../../navigation/useShellTabBarVisibility', () => ({
  useShellTabBarVisibility: () => false,
  useShellTabBarScrollInset: () => 0,
  shellTabBarHeightPx: () => 0,
}));
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => false }));
vi.mock('../../../hooks/useModalHardwareBack', () => ({ useModalHardwareBack: () => undefined }));

import { BottomSheet } from '../BottomSheet';
import { FormScreen } from '../FormScreen';
import { FormScrollView } from '../FormScrollView';
import { Modal } from '../Modal';
import { Screen } from '../Screen';
import { TextField } from '../TextField';

afterEach(cleanup);

const themed = (ui: React.ReactElement) =>
  render(<ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>{ui}</ThemeProvider>);

const twoFields = (
  <>
    <TextField label="First" />
    <TextField label="Second" />
  </>
);
const hint = (el: HTMLElement) => el.getAttribute('enterkeyhint');

describe('form scope in the shared primitives', () => {
  it('Screen (scroll) gives its fields the Next return key', () => {
    const { getByLabelText } = themed(<Screen scroll>{twoFields}</Screen>);
    expect(hint(getByLabelText('First'))).toBe('next');
  });

  it('Screen (no scroll) and FormScrollView inside it share one scope', () => {
    const { getByLabelText } = themed(
      <Screen>
        <FormScrollView>{twoFields}</FormScrollView>
      </Screen>,
    );
    expect(hint(getByLabelText('Second'))).toBe('next');
  });

  it('BottomSheet gives its fields the Next return key', () => {
    const { getByLabelText } = themed(
      <BottomSheet visible title="Sheet" onDismiss={() => {}}>
        {twoFields}
      </BottomSheet>,
    );
    expect(hint(getByLabelText('First'))).toBe('next');
  });

  it('Modal gives its fields the Next return key', () => {
    const { getByLabelText } = themed(
      <Modal visible title="Dialog" onDismiss={() => {}}>
        {twoFields}
      </Modal>,
    );
    expect(hint(getByLabelText('First'))).toBe('next');
  });

  it('a FormScreen nested in a Screen joins the Screen scope instead of adding a second toolbar', () => {
    const { queryAllByText } = themed(
      <Screen>
        <FormScreen embedded>{twoFields}</FormScreen>
      </Screen>,
    );
    // Android-style row would render the labels; with iOS-less jsdom none may appear twice.
    expect(queryAllByText('common.formKeyboard.next').length).toBeLessThanOrEqual(1);
  });

  it('a lone field (search / note box) gets no toolbar attachment', () => {
    const { getByLabelText } = themed(
      <Screen scroll>
        <TextField label="Only" />
      </Screen>,
    );
    expect(getByLabelText('Only').getAttribute('inputaccessoryviewid')).toBeNull();
    expect(hint(getByLabelText('Only'))).toBe('done');
  });

  it('an explicit returnKeyType (e.g. a search field) is never overridden', () => {
    const { getByLabelText } = themed(
      <Screen scroll>
        <TextField label="Search" returnKeyType="search" />
        <TextField label="Other" />
      </Screen>,
    );
    expect(hint(getByLabelText('Search'))).toBe('search');
  });
});
