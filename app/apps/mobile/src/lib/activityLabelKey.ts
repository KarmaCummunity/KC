// FR-STATS-003, FR-CLOSURE-011 AC9 (#2078) — the i18n key of one personal activity timeline row.
// A closed post keeps the status `closed_delivered` in every world, but volunteering is not
// "delivered": time-world rows that speak of a hand-over read as volunteering instead.
import type { PersonalActivityItem, PersonalActivityKind } from '@kc/domain';

/** Row kinds whose item wording ("delivered", "recipient") does not fit volunteering. */
const VOLUNTEERING_WORDED_KINDS: ReadonlySet<PersonalActivityKind> = new Set([
  'post_closed_delivered',
  'marked_as_recipient',
  'unmarked_as_recipient',
]);

/** `stats.activityKindTime.<kind>` for a volunteering hand-over row, else `stats.activityKind.<kind>`. */
export function activityLabelKey(item: Pick<PersonalActivityItem, 'kind' | 'worldSlug'>): string {
  if (item.worldSlug === 'time' && VOLUNTEERING_WORDED_KINDS.has(item.kind)) {
    return `stats.activityKindTime.${item.kind}`;
  }
  return `stats.activityKind.${item.kind}`;
}
