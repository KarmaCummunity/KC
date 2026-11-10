// G40 — items world (docs/spec §5.2): give → reserve → confirm → hand over → rate, two users.
import { defineWorldJourney } from '../lib/worldJourney';

defineWorldJourney({
  world: 'items',
  kindSlug: 'give_item',
  titleHe: 'כיסא עץ למסירה',
  claim: { testId: 'giving-handoff-reserve', label: 'שריון הפריט', resultsIn: 'reserved' },
  // Matches give_item detail_schema (0241); pickup_mode is a handoff column, not listing details.
  details: () => ({ item_condition: 'Good', fulfillment_mode: 'owner_approval' }),
});
