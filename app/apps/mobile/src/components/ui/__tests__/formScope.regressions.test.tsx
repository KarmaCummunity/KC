// @vitest-environment jsdom
// FR-RESP-006 AC25–AC27 — form scope edge cases found in the form audit: each test pins a bug that
// the scope used to have (wrong field focused, screen yanked away from typing, shared iOS toolbar).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { Keyboard, type ScrollView, type View } from 'react-native';
import { BLUR_VALIDATION_WINDOW_MS, useFormScopeController, type FormFieldHandle } from '../formScope';

/** A field at window position (x, y) whose focusability can change after it registers. */
function fakeField(x: number, y: number) {
  const focus = vi.fn();
  const state = { focusable: true };
  const view = { measureInWindow: (cb: (x: number, y: number) => void) => cb(x, y) } as unknown as View;
  const handle: FormFieldHandle = { focus, view: () => view, isFocusable: () => state.focusable };
  return { handle, focus, state };
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

describe('keyboard navigation edge cases', () => {
  it('Next from a field that just became disabled focuses nothing (never jumps to the top field)', async () => {
    const { hook } = setup();
    const top = fakeField(0, 10);
    const houseNumber = fakeField(0, 100);
    const { scope } = hook.result.current;
    scope.register('top', top.handle);
    scope.register('house', houseNumber.handle);
    scope.notifyFocus('house');
    await settle();

    houseNumber.state.focusable = false;
    act(() => hook.result.current.accessoryProps.onNext());
    await settle();
    expect(top.focus).not.toHaveBeenCalled();
  });

  it('Return moves on from the field it was pressed in, whatever the scope last saw focused', async () => {
    const { hook } = setup();
    const a = fakeField(0, 10);
    const b = fakeField(0, 100);
    const c = fakeField(0, 200);
    const { scope } = hook.result.current;
    scope.register('a', a.handle);
    scope.register('b', b.handle);
    scope.register('c', c.handle);
    scope.notifyFocus('a');

    act(() => scope.submitEditing('b'));
    await settle();
    expect(c.focus).toHaveBeenCalledTimes(1);
    expect(b.focus).not.toHaveBeenCalled();
  });

  it('names the last focusable field, so only that one shows "done"', async () => {
    const { hook } = setup();
    const { scope } = hook.result.current;
    scope.register('low', fakeField(0, 300).handle);
    scope.register('high', fakeField(0, 20).handle);
    scope.notifyFocus('high');
    await settle();
    expect(hook.result.current.scope.lastFocusableId).toBe('low');
  });

  it('gives every scope its own iOS toolbar id, so a sheet over a form never drives the form behind it', () => {
    const first = renderHook(() => useFormScopeController());
    const second = renderHook(() => useFormScopeController());
    expect(first.result.current.scope.accessoryId).not.toBe(second.result.current.scope.accessoryId);
    expect(first.result.current.accessoryProps.nativeId).toBe(first.result.current.scope.accessoryId);
  });

  it('mounts the iOS toolbar only once the form has two fields', () => {
    const { hook } = setup();
    expect(hook.result.current.accessoryProps.enabled).toBe(false);
    act(() => {
      hook.result.current.scope.register('a', fakeField(0, 10).handle);
      hook.result.current.scope.register('b', fakeField(0, 100).handle);
    });
    expect(hook.result.current.accessoryProps.enabled).toBe(true);
  });
});

describe('jump to the problem field: when not to move the screen', () => {
  it('does not yank the screen back when a field validated on blur while the next one is being typed in', async () => {
    const { hook, scrollTo } = setup();
    const { scope } = hook.result.current;
    scope.register('a', fakeField(0, 100).handle);
    scope.register('b', fakeField(0, 400).handle);
    scope.notifyFocus('a');
    // Next: A loses focus, B gains it, and A's blur validation then shows an error.
    scope.notifyBlur('a');
    scope.notifyFocus('b');
    scope.setInvalid('a', true, true);
    await settle();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('still jumps when the error follows a blur caused by tapping submit (no field focused, e.g. web)', async () => {
    const { hook, scrollTo } = setup();
    const { scope } = hook.result.current;
    scope.register('a', fakeField(0, 400).handle);
    scope.notifyFocus('a');
    scope.notifyBlur('a');
    scope.setInvalid('a', true, true);
    await settle();
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it('jumps again for an error that appears well after its field was left', async () => {
    const now = vi.spyOn(Date, 'now');
    const { hook, scrollTo } = setup();
    const { scope } = hook.result.current;
    scope.register('a', fakeField(0, 100).handle);
    scope.register('b', fakeField(0, 400).handle);
    now.mockReturnValue(1_000);
    scope.notifyBlur('a');
    scope.notifyFocus('b');
    now.mockReturnValue(1_000 + BLUR_VALIDATION_WINDOW_MS);
    scope.setInvalid('a', true, true);
    await settle();
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it('scrolls once when a bumped submit signal and new errors land in the same commit', async () => {
    const { hook, scrollTo } = setup();
    const { scope } = hook.result.current;
    scope.register('a', fakeField(0, 400).handle);
    scope.register('b', fakeField(0, 600).handle);
    act(() => {
      scope.scrollToFirstInvalid();
      scope.setInvalid('a', true, true);
      scope.setInvalid('b', true, true);
    });
    await settle();
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });
});
