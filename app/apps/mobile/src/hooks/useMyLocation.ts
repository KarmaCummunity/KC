// Foreground location for the map's "near me" (approximate accuracy; never stored).
import { useCallback, useEffect, useState } from 'react';
import * as Location from 'expo-location';

export type MyLocationStatus = 'idle' | 'locating' | 'granted' | 'denied' | 'error';

export function useMyLocation() {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [status, setStatus] = useState<MyLocationStatus>('idle');

  const read = useCallback(async () => {
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    setCoords(c);
    setStatus('granted');
    return c;
  }, []);

  /** Ask for permission (if needed) and read the position. Returns null when unavailable. */
  const locate = useCallback(async () => {
    setStatus('locating');
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        setStatus('denied');
        return null;
      }
      return await read();
    } catch {
      setStatus('error');
      return null;
    }
  }, [read]);

  /** Silent: only reads when permission was already granted earlier. */
  const [initial, setInitial] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.status === 'granted' && alive) {
          const c = await read();
          if (alive) setInitial(c);
        }
      } catch {
        /* ignore — stay on the default city */
      }
    })();
    return () => {
      alive = false;
    };
  }, [read]);

  return { coords, status, locate, initial };
}
