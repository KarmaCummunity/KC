// G40 — items world (docs/spec §5.2): give → reserve → confirm → hand over → rate, two users.
import { defineWorldJourney } from '../lib/worldJourney';

defineWorldJourney({
  world: 'items',
  kindSlug: 'give_item',
  titleHe: 'כיסא עץ למסירה',
  claim: { testId: 'giving-handoff-reserve', label: 'שריון הפריט', resultsIn: 'reserved' },
  details: () => ({ pickup_mode: 'pickup' }),
});
