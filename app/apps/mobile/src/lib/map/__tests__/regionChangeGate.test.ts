// Regression: panning the map then waiting ~1s crashed the app (#1214 follow-up).
// Rapid region events must be coalesced, validated, and inert after unmount.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOD_REGION } from '@kc/domain';
import { createRegionChangeGate } from '../regionChangeGate';

describe('createRegionChangeGate', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('coalesces a burst of rapid region changes into one emit', () => {
    const emit = vi.fn();
    const gate = createRegionChangeGate(emit, 250);
    for (let i = 0; i < 30; i++) gate.push({ ...LOD_REGION, latitude: LOD_REGION.latitude + i * 0.01 });
    expect(emit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]![0].latitude).toBeCloseTo(LOD_REGION.latitude + 0.29);
  });

  it('drops invalid regions (NaN / missing / null)', () => {
    const emit = vi.fn();
    const gate = createRegionChangeGate(emit, 10);
    gate.push(null);
    gate.push(undefined);
    gate.push({ ...LOD_REGION, latitude: NaN });
    gate.push({ latitude: 1, longitude: 1 });
    vi.advanceTimersByTime(50);
    expect(emit).not.toHaveBeenCalled();
  });

  it('skips a region that is effectively unchanged (no setState loop)', () => {
    const emit = vi.fn();
    const gate = createRegionChangeGate(emit, 10);
    gate.push(LOD_REGION);
    vi.advanceTimersByTime(10);
    gate.push({ ...LOD_REGION, latitude: LOD_REGION.latitude + 1e-7 });
    vi.advanceTimersByTime(10);
    expect(emit).toHaveBeenCalledTimes(1);
    gate.push({ ...LOD_REGION, latitude: LOD_REGION.latitude + 0.02 });
    vi.advanceTimersByTime(10);
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it('never emits after dispose (unmounted map)', () => {
    const emit = vi.fn();
    const gate = createRegionChangeGate(emit, 100);
    gate.push(LOD_REGION);
    gate.dispose();
    vi.advanceTimersByTime(500);
    gate.push({ ...LOD_REGION, latitude: 32.5 });
    vi.advanceTimersByTime(500);
    expect(emit).not.toHaveBeenCalled();
  });
});
