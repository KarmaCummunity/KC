import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InteractionManager } from 'react-native';

vi.mock('react-native', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-native');
  return {
    ...actual,
    InteractionManager: {
      runAfterInteractions: vi.fn((fn: () => void) => fn()),
    },
  };
});

import { runAfterBottomSheetDismiss } from '../runAfterBottomSheetDismiss';

describe('runAfterBottomSheetDismiss', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('schedules work via InteractionManager.runAfterInteractions', () => {
    const work = vi.fn();
    runAfterBottomSheetDismiss(work);

    expect(InteractionManager.runAfterInteractions).toHaveBeenCalledTimes(1);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('safely handles async work without rejection unhandled', async () => {
    const asyncWork = vi.fn().mockResolvedValue(undefined);
    runAfterBottomSheetDismiss(asyncWork);

    expect(asyncWork).toHaveBeenCalledTimes(1);
  });
});
