// @vitest-environment jsdom
// Shared Modal and BottomSheet (spec 17 §4.1, issue #1284): naming, dismissal paths,
// blocking mode, safe areas and reduced motion. Both share `overlayParts`, so each
// behaviour is checked against both components.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ThemeProvider, Text } from '@kc/ui';

vi.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
// Stub safe-area-context: its real entry does not load under jsdom (see Screen tests).
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 20, bottom: 34, left: 0, right: 0 }) }));
const reducedMotion = vi.hoisted(() => ({ value: false }));
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => reducedMotion.value }));
// The modal stack and Android back handler are covered by their own hook; spy on the wiring.
const hardwareBack = vi.hoisted(() => vi.fn());
vi.mock('../../../hooks/useModalHardwareBack', () => ({ useModalHardwareBack: hardwareBack }));

import { BottomSheet } from '../BottomSheet';
import { Modal } from '../Modal';

afterEach(() => {
  cleanup();
  reducedMotion.value = false;
  hardwareBack.mockClear();
});

type OverlayProps = React.ComponentProps<typeof Modal>;
const OVERLAYS = [
  ['Modal', (props: OverlayProps) => <Modal {...props} />],
  ['BottomSheet', (props: OverlayProps) => <BottomSheet {...props} />],
] as const;

function renderOverlay(Overlay: (props: OverlayProps) => React.ReactElement, props: Partial<OverlayProps> = {}) {
  const onDismiss = vi.fn();
  const utils = render(
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
      <Overlay visible onDismiss={onDismiss} title="Report post" testID="overlay" {...props}>
        <Text>Body copy</Text>
      </Overlay>
    </ThemeProvider>,
  );
  finishOpenAnimation();
  return { ...utils, onDismiss };
}

/**
 * React Native Web's Modal becomes the active dialog (role, Escape handling)
 * only when its fade-in ends; jsdom runs no CSS animations, so end it by hand on
 * every ancestor of the dialog wrapper (only the animated one listens).
 */
function finishOpenAnimation() {
  let node = document.querySelector('[aria-modal="true"]')?.parentElement ?? null;
  while (node) {
    fireEvent.animationEnd(node);
    node = node.parentElement;
  }
}

describe.each(OVERLAYS)('%s', (_name, Overlay) => {
  it('renders a dialog named by its title, with the body and a heading', () => {
    const { getByRole, getByText } = renderOverlay(Overlay);
    expect(getByRole('dialog', { name: 'Report post' })).toBeTruthy();
    expect(getByRole('heading').textContent).toBe('Report post');
    expect(getByText('Body copy')).toBeTruthy();
  });

  it('renders nothing while not visible', () => {
    const { queryByRole, queryByText } = renderOverlay(Overlay, { visible: false });
    expect(queryByRole('dialog')).toBeNull();
    expect(queryByText('Body copy')).toBeNull();
  });

  it('dismisses from the named close control, the backdrop and Escape', () => {
    const { getByRole, getByTestId, onDismiss } = renderOverlay(Overlay);
    fireEvent.click(getByRole('button', { name: 'general.close' }));
    fireEvent.click(getByTestId('overlay-backdrop'));
    fireEvent.keyUp(document, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(3);
  });

  it('routes the Android back button through the same dismissal while open', () => {
    const { onDismiss } = renderOverlay(Overlay);
    const [active, onBack] = hardwareBack.mock.calls.at(-1) as [boolean, () => void];
    expect(active).toBe(true);
    onBack();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('ignores every dismiss gesture and hides the close control when not dismissible', () => {
    const { queryByRole, getByTestId, onDismiss } = renderOverlay(Overlay, { dismissible: false });
    expect(queryByRole('button', { name: 'general.close' })).toBeNull();
    fireEvent.click(getByTestId('overlay-backdrop'));
    fireEvent.keyUp(document, { key: 'Escape' });
    const [, onBack] = hardwareBack.mock.calls.at(-1) as [boolean, () => void];
    onBack();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('uses a custom close label when given', () => {
    const { getByRole } = renderOverlay(Overlay, { closeAccessibilityLabel: 'Close the report form' });
    expect(getByRole('button', { name: 'Close the report form' })).toBeTruthy();
  });

  it('renders the footer actions', () => {
    const { getByText } = renderOverlay(Overlay, { footer: <Text>Send report</Text> });
    expect(getByText('Send report')).toBeTruthy();
  });
});

describe('Modal — layout', () => {
  it('keeps the surface inside the safe area, with at least the base gutter', () => {
    const { getByTestId } = renderOverlay(OVERLAYS[0][1]);
    const frame = getByTestId('overlay').parentElement as HTMLElement;
    // insets.top 20 + spacing.base 16; insets.bottom 34 + spacing.base 16.
    expect(getComputedStyle(frame).paddingTop).toBe('36px');
    expect(getComputedStyle(frame).paddingBottom).toBe('50px');
  });
});

describe('BottomSheet — layout and motion', () => {
  it('pads its content above the home indicator', () => {
    const { getByTestId } = renderOverlay(OVERLAYS[1][1]);
    // insets.bottom 34 + spacing.base 16.
    expect(getComputedStyle(getByTestId('overlay')).paddingBottom).toBe('50px');
  });

  it('opens in place without sliding under reduced motion', () => {
    reducedMotion.value = true;
    const { getByTestId } = renderOverlay(OVERLAYS[1][1]);
    expect(getComputedStyle(getByTestId('overlay')).transform).toBe('translateY(0px)');
  });

  it('caps a compact sheet at the given share of the screen', () => {
    const { getByTestId } = renderOverlay(OVERLAYS[1][1], { maxHeight: '58%' } as Partial<OverlayProps>);
    expect(getComputedStyle(getByTestId('overlay')).maxHeight).toBe('58%');
  });

  it('grows to the full height under the status-bar gap by default', () => {
    const { getByTestId } = renderOverlay(OVERLAYS[1][1]);
    expect(getComputedStyle(getByTestId('overlay')).maxHeight).toBe('100%');
  });

  it('renders a body that brings its own list without the scroll wrapper', () => {
    const { getByText } = renderOverlay(OVERLAYS[1][1], { scrollable: false } as Partial<OverlayProps>);
    expect(getByText('Body copy')).toBeTruthy();
  });
});
