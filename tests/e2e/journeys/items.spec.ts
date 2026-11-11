// G40 — items world (docs/spec §5.2): give → reserve → confirm → hand over → rate, two users.
import { defineWorldJourney } from '../lib/worldJourney';

defineWorldJourney({
  world: 'items',
  kindSlug: 'item_offer',
  publish: 'plain',
  titleHe: 'כיסא עץ למסירה',
  claim: { testId: 'giving-handoff-reserve', label: 'שריון הפריט', resultsIn: 'reserved' },
  // A plain post: no detail row; pickup_mode is a handoff column.
  details: () => ({}),
});
