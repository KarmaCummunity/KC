// FR-KARMA-009 — realtime UPDATE payloads on public.users only carry the
// columns the subscriber may SELECT (TD-163 column grants), so owner-private
// fields such as karma_points arrive as undefined/null. Merging them blindly
// over the cached self profile wiped the karma total to 0 (header showed 0
// while the ledger listed points). Keep the previous value for any field the
// payload does not carry.
import type { User } from '@kc/domain';

export function mergeSelfRealtimeUser(prev: User | undefined | null, next: User): User {
  if (!prev) return next;
  const merged: Record<string, unknown> = { ...prev };
  for (const [k, v] of Object.entries(next)) {
    if (v !== undefined && v !== null) merged[k] = v;
    else if (!(k in merged)) merged[k] = v;
  }
  return merged as unknown as User;
}
