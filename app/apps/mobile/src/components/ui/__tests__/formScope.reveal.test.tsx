// @vitest-environment jsdom
// FR-RESP-006 AC25 — on a phone, keyboard Next / Previous moves the screen with the focus: the field
// it lands on is scrolled fully into view above the keyboard, and a visible field leaves it alone.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ScrollView, View } from 'react-native';

vi.mock('react-native', async () => {
  const RN = await vi.importActual<typeof import('react-native')>('react-native');
  return { ...RN, Platform: { ...RN.Platform, OS: 'ios', select: (o: { ios?: unknown }) => o.ios } };
});

import { useFormScopeController, type FormFieldHandle } from '../formScope';

/** A field at window y with a height, recording focus calls. */
function fakeField(y: number, height = 48) {
  const focus = vi.fn();
  const view = {
    measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => cb(0, y, 300, height),
  } as unknown as View;
  const handle: FormFieldHandle = { focus, view: () => view, isFocusable: () => true };
  return { handle, focus };
}

/** Let measuring promises and animation frames settle. */
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 150)); });

function setup() {
  const hook = renderHook(() => useFormScopeController());
  const scrollTo = vi.fn();
  // The scroller fills the screen from the top: 0–800.
  hook.result.current.scrollProps.ref.current = {
    scrollTo,
    measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => cb(0, 0, 360, 800),
  } as unknown as ScrollView;
  return { hook, scrollTo };
}

afterEach(() => vi.restoreAllMocks());

describe('keyboard Next / Previous scrolls with the focus', () => {
  it('scrolls a field lying below the visible area into view when Next lands on it', async () => {
    const { hook, scrollTo } = setup();
    const top = fakeField(100);
    const below = fakeField(1200);
    const { scope } = hook.result.current;
    scope.register('top', top.handle);
    scope.register('below', below.handle);
    scope.notifyFocus('top');
    await settle();

    act(() => hook.result.current.accessoryProps.onNext());
    await settle();
    expect(below.focus).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo.mock.calls[0]![0].y).toBeGreaterThan(0);
  });

  it('does not move the screen when the next field is already visible', async () => {
    const { hook, scrollTo } = setup();
    const a = fakeField(100);
    const b = fakeField(300);
    const { scope } = hook.result.current;
    scope.register('a', a.handle);
    scope.register('b', b.handle);
    scope.notifyFocus('a');
    await settle();

    act(() => scope.submitEditing('a'));
    await settle();
    expect(b.focus).toHaveBeenCalledTimes(1);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
