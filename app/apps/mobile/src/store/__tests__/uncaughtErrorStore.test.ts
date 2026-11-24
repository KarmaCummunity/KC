import { describe, it, expect, beforeEach } from 'vitest';
import { useUncaughtErrorStore } from '../uncaughtErrorStore';

beforeEach(() => {
  // Reset between tests so ordering never leaks a held fatal error.
  useUncaughtErrorStore.getState().clear();
});

describe('useUncaughtErrorStore', () => {
  it('starts with no intercepted error', () => {
    expect(useUncaughtErrorStore.getState().error).toBeNull();
  });

  it('show stores the first fatal error', () => {
    const first = new Error('boom');
    useUncaughtErrorStore.getState().show(first);
    expect(useUncaughtErrorStore.getState().error).toBe(first);
  });

  it('show keeps the first error when a second fatal arrives', () => {
    const first = new Error('first');
    const second = new Error('second');
    useUncaughtErrorStore.getState().show(first);
    useUncaughtErrorStore.getState().show(second);
    expect(useUncaughtErrorStore.getState().error).toBe(first);
    expect(useUncaughtErrorStore.getState().error).not.toBe(second);
  });

  it('clear dismisses the held error so retry can remount the shell', () => {
    useUncaughtErrorStore.getState().show(new Error('fatal'));
    expect(useUncaughtErrorStore.getState().error).not.toBeNull();

    useUncaughtErrorStore.getState().clear();
    expect(useUncaughtErrorStore.getState().error).toBeNull();
  });

  it('show after clear accepts a new fatal error', () => {
    const first = new Error('first');
    const next = new Error('next');
    useUncaughtErrorStore.getState().show(first);
    useUncaughtErrorStore.getState().clear();
    useUncaughtErrorStore.getState().show(next);
    expect(useUncaughtErrorStore.getState().error).toBe(next);
  });
});
