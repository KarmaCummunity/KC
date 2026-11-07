// FR-DONATE-001 AC8 — the Donations hub tiles in this member's order: active worlds first, then
// portals, each group by a time-decayed visit score kept on the device only (never sent).
// The order is taken when the screen gains focus, so tiles never jump under the finger.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { orderWorldsByAffinity, parseWorldAffinity, recordWorldVisit, type WorldAffinity } from '@kc/domain';
import { useAuthStore } from '../store/authStore';

export function worldAffinityKey(userId: string | null): string {
  return `kc-world-affinity-${userId ?? 'guest'}`;
}

interface OrderableTile {
  readonly key: string;
  readonly portal?: boolean;
}

export function useHubWorldOrder<T extends OrderableTile>(tiles: readonly T[]) {
  const userId = useAuthStore((s) => s.session?.userId ?? null);
  const storageKey = worldAffinityKey(userId);
  // The latest scores (visits update it at once); `shown` is what the current order is built from.
  const latest = useRef<WorldAffinity>({});
  const [shown, setShown] = useState<{ affinity: WorldAffinity; at: number }>({ affinity: {}, at: Date.now() });

  useEffect(() => {
    let cancelled = false;
    latest.current = {};
    AsyncStorage.getItem(storageKey)
      .then((raw) => {
        // A visit recorded while the read was in flight wins over the stored entry.
        latest.current = { ...parseWorldAffinity(raw ? JSON.parse(raw) : null), ...latest.current };
        if (!cancelled) setShown({ affinity: latest.current, at: Date.now() });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  useFocusEffect(
    useCallback(() => {
      setShown({ affinity: latest.current, at: Date.now() });
    }, []),
  );

  const recordOpen = useCallback(
    (worldKey: string) => {
      latest.current = recordWorldVisit(latest.current, worldKey, Date.now());
      AsyncStorage.setItem(storageKey, JSON.stringify(latest.current)).catch(() => {});
    },
    [storageKey],
  );

  const ordered = useMemo(
    () => orderWorldsByAffinity(tiles, (t) => t.key, (t) => Boolean(t.portal), shown.affinity, shown.at),
    [tiles, shown],
  );

  return { ordered, recordOpen };
}
