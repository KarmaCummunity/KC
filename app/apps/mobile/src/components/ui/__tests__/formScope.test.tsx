// @vitest-environment jsdom
// FR-RESP-006 — form scope: reading-order Next / Previous and jump-to-first-problem-field.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { Keyboard, type ScrollView, type View } from 'react-native';
import { useFormScopeController, type FormFieldHandle } from '../formScope';

/** A field at window position (x, y) that records focus calls. */
function fakeField(x: number, y: number, focusable = true) {
  const focus = vi.fn();
  const view = { measureInWindow: (cb: (x: number, y: number) => void) => cb(x, y) } as unknown as View;
  const handle: FormFieldHandle = { focus, view: () => view, isFocusable: () => focusable };
  return { handle, focus };
}

/** Let queued promises (field measuring) and animation frames settle. */
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 150)); });

function setup() {
  const hook = renderHook(() => useFormScopeController());
  const scrollTo = vi.fn();
  hook.result.current.scrollProps.ref.current = {
    scrollTo,
    measureInWindow: (cb: (x: number, y: number) => void) => cb(0, 0),
  } as unknown as ScrollView;
  return { hook, scrollTo };
}

beforeEach(() => {
  vi.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('keyboard navigation', () => {
  it('moves to the next / previous field in screen order, not registration order', async () => {
    const { hook } = setup();
    const top = fakeField(0, 10);
    const middle = fakeField(0, 100);
    const bottom = fakeField(0, 200);
    const { scope } = hook.result.current;
    // Registered out of order on purpose.
    scope.register('bottom', bottom.handle);
    scope.register('top', top.handle);
    scope.register('middle', middle.handle);

    scope.notifyFocus('top');
    await settle();
    act(() => hook.result.current.accessoryProps.onNext());
    await settle();
    expect(middle.focus).toHaveBeenCalledTimes(1);

    hook.result.current.scope.notifyFocus('middle');
    await settle();
    act(() => hook.result.current.accessoryProps.onPrev());
    await settle();
    expect(top.focus).toHaveBeenCalledTimes(1);
  });

  it('reports canGoPrev / canGoNext for the focused field and skips disabled fields', async () => {
    const { hook } = setup();
    const first = fakeField(0, 10);
    const disabled = fakeField(0, 100, false);
    const last = fakeField(0, 200);
    const { scope } = hook.result.current;
    scope.register('a', first.handle);
    scope.register('b', disabled.handle);
    scope.register('c', last.handle);

    scope.notifyFocus('a');
    await settle();
    expect(hook.result.current.accessoryProps).toMatchObject({ canGoPrev: false, canGoNext: true });

    act(() => hook.result.current.accessoryProps.onNext());
    await settle();
    expect(last.focus).toHaveBeenCalledTimes(1);
    expect(disabled.focus).not.toHaveBeenCalled();

    hook.result.current.scope.notifyFocus('c');
    await settle();
    expect(hook.result.current.accessoryProps).toMatchObject({ canGoPrev: true, canGoNext: false });
  });

  it('closes the keyboard when Return is pressed in the last field', async () => {
    const { hook } = setup();
    hook.result.current.scope.register('only', fakeField(0, 10).handle);
    hook.result.current.scope.notifyFocus('only');
    await settle();
    act(() => hook.result.current.scope.submitEditing('only'));
    await settle();
    expect(Keyboard.dismiss).toHaveBeenCalled();
  });

  it('stops tracking a field once it unmounts', async () => {
    const { hook } = setup();
    const a = fakeField(0, 10);
    const b = fakeField(0, 100);
    const unregisterB = (() => {
      hook.result.current.scope.register('a', a.handle);
      return hook.result.current.scope.register('b', b.handle);
    })();
    unregisterB();
    hook.result.current.scope.notifyFocus('a');
    await settle();
    expect(hook.result.current.accessoryProps.canGoNext).toBe(false);
  });
});

describe('jump to the first problem field', () => {
  it('scrolls to the top-most invalid field when several errors appear at once', async () => {
    const { hook, scrollTo } = setup();
    const { scope } = hook.result.current;
    scope.register('low', fakeField(0, 600).handle);
    scope.register('high', fakeField(0, 240).handle);
    scope.register('ok', fakeField(0, 40).handle);

    scope.setInvalid('low', true, true);
    scope.setInvalid('high', true, true);
    await settle();

    expect(Keyboard.dismiss).toHaveBeenCalled();
    expect(scrollTo).toHaveBeenCalledTimes(1);
    // y = scrollY(0) + (240 - 0) - top padding: the high field, never the low one.
    expect(scrollTo.mock.calls[0]![0].y).toBeGreaterThan(0);
    expect(scrollTo.mock.calls[0]![0].y).toBeLessThanOrEqual(240);
  });

  it('does not scroll for an error present on the first render', async () => {
    const { hook, scrollTo } = setup();
    hook.result.current.scope.register('f', fakeField(0, 400).handle);
    hook.result.current.scope.setInvalid('f', true, false);
    await settle();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('does not scroll for live validation on the field being typed in', async () => {
    const { hook, scrollTo } = setup();
    hook.result.current.scope.register('typing', fakeField(0, 400).handle);
    hook.result.current.scope.notifyFocus('typing');
    hook.result.current.scope.setInvalid('typing', true, true);
    await settle();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('scrollToFirstInvalid re-scrolls on a repeated failed submit with unchanged errors', async () => {
    const { hook, scrollTo } = setup();
    hook.result.current.scope.register('f', fakeField(0, 400).handle);
    hook.result.current.scope.setInvalid('f', true, true);
    await settle();
    expect(scrollTo).toHaveBeenCalledTimes(1);

    act(() => hook.result.current.scrollToFirstInvalid());
    await settle();
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it('does nothing once the error is fixed', async () => {
    const { hook, scrollTo } = setup();
    hook.result.current.scope.register('f', fakeField(0, 400).handle);
    hook.result.current.scope.setInvalid('f', true, false);
    hook.result.current.scope.setInvalid('f', false, true);
    act(() => hook.result.current.scrollToFirstInvalid());
    await settle();
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
