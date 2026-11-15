// Animals world (docs/spec/05_giving_worlds.md §5.9, D125): hand an animal over → reserve → confirm → hand over → rate, two users.
// An adoption offer takes the item handoff (kc_private.handoff_flow_of: 'request'), so the journey is the items shape.
import { defineWorldJourney } from '../lib/worldJourney';

defineWorldJourney({
  world: 'animals',
  kindSlug: 'adoption_offer',
  publish: 'plain',
  titleHe: 'כלבה בת שנתיים מחפשת בית',
  claim: { testId: 'giving-handoff-reserve', label: 'שריון הפריט', resultsIn: 'reserved' },
  // The animals fields live in posts.details; species is the one the create form requires.
  details: () => ({ species: 'dog', age_group: 'adult', sex: 'female', vaccinated: true }),
});
