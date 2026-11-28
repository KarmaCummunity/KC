// A member id read from a post or a handoff is NULL once that member deleted their account
// (#2088: `posts.owner_id`, `post_handoffs.owner_id` and `recipient_id` are `on delete set null`).
// The app shows such a member as "Deleted user"; there is no row of them to look up.

/** The distinct ids of members who still exist (a NULL id is a deleted member). */
export function presentMemberIds(ids: readonly (string | null)[]): string[] {
  return [...new Set(ids.filter((id): id is string => id !== null))];
}

/** The entry of a member in `byId`; undefined for a deleted member (NULL id). */
export function memberEntry<T>(byId: ReadonlyMap<string, T>, id: string | null): T | undefined {
  return id === null ? undefined : byId.get(id);
}
