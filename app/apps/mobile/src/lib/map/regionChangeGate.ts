// Debounced, validated region-change gate for the native map (#1214 follow-up).
// Native maps fire onRegionChangeComplete in bursts while panning; each burst used to
// re-cluster and remount markers, which crashed the native view tree. This gate drops
// invalid regions, coalesces bursts, skips no-op moves and is inert after dispose().
import { regionsNearlyEqual, sanitizeRegion, type MapRegion } from '@kc/domain';

export interface RegionChangeGate {
  push(r: Partial<MapRegion> | null | undefined): void;
  dispose(): void;
}

interface Timers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (h: unknown) => void;
}

const defaultTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export function createRegionChangeGate(
  emit: (r: MapRegion) => void,
  delayMs = 250,
  timers: Timers = defaultTimers,
): RegionChangeGate {
  let handle: unknown = null;
  let last: MapRegion | null = null;
  let disposed = false;

  return {
    push(raw) {
      if (disposed) return;
      const r = sanitizeRegion(raw);
      if (!r) return;
      if (handle != null) timers.clear(handle);
      handle = timers.set(() => {
        handle = null;
        if (disposed) return;
        if (last && regionsNearlyEqual(last, r)) return;
        last = r;
        emit(r);
      }, delayMs);
    },
    dispose() {
      disposed = true;
      if (handle != null) timers.clear(handle);
      handle = null;
    },
  };
}
