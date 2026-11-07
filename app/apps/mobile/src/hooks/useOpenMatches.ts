// Open match suggestions (not "waiting on other side"), optionally scoped to one giving world.
import { useMemo } from 'react';
import { matchStateOf } from '../lib/matching';
import { useMyMatches } from './useMyMatches';

export function useOpenMatches(worldSlug?: string, limit = 20) {
  const query = useMyMatches(limit);
  const open = useMemo(() => {
    let list = (query.data ?? []).filter((m) => matchStateOf(m) !== 'waiting');
    if (worldSlug) list = list.filter((m) => m.worldSlug === worldSlug);
    return list;
  }, [query.data, worldSlug]);
  return { ...query, open };
}
