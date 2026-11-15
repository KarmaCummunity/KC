import { describe, expect, it } from 'vitest';
import { resolveKeyboardAvoidingBehavior, resolveKeyboardVerticalOffset } from '../keyboardVerticalOffset';

describe('resolveKeyboardVerticalOffset', () => {
  it('returns 0 on android and web', () => {
    expect(resolveKeyboardVerticalOffset('android', 24, 44)).toBe(0);
    expect(resolveKeyboardVerticalOffset('web', 0, 44)).toBe(0);
  });

  it('adds header and top inset on ios when a stack header is shown', () => {
    expect(resolveKeyboardVerticalOffset('ios', 59, 44)).toBe(103);
  });

  it('uses headerless mode — top inset only', () => {
    expect(resolveKeyboardVerticalOffset('ios', 59, 44, { headerless: true })).toBe(59);
  });

  it('honours an explicit header height override', () => {
    expect(resolveKeyboardVerticalOffset('ios', 20, 44, { headerHeight: 56 })).toBe(76);
  });

  it('skips top inset when content already sits below the safe area', () => {
    expect(
      resolveKeyboardVerticalOffset('ios', 59, 0, {
        headerHeight: 52,
        contentBelowTopSafeArea: true,
      }),
    ).toBe(52);
  });
});

describe('resolveKeyboardAvoidingBehavior', () => {
  it('pads the bottom on iOS', () => {
    expect(resolveKeyboardAvoidingBehavior('ios')).toBe('padding');
  });

  it('shrinks the height on android, where edge-to-edge no longer resizes the window', () => {
    expect(resolveKeyboardAvoidingBehavior('android')).toBe('height');
  });

  it('does nothing on web, which has no software keyboard', () => {
    expect(resolveKeyboardAvoidingBehavior('web')).toBeUndefined();
  });
});
