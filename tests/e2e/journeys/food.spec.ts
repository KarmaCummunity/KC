// G40 — food world (docs/spec §5.1): give (with expiry) → quick claim (confirmed at once) → hand over → rate, two users.
import { defineWorldJourney } from '../lib/worldJourney';

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

defineWorldJourney({
  world: 'food',
  kindSlug: 'give_food',
  titleHe: 'עוגיות טריות לחלוקה',
  claim: { testId: 'giving-handoff-claim', label: 'תפיסה מהירה — הצלת מזון', resultsIn: 'confirmed' },
  // The food form requires a future expiry (marketplaceWorldRules: food_expiry_required).
  details: () => ({ pickup_mode: 'pickup', expires_at: new Date(Date.now() + TWO_DAYS_MS).toISOString() }),
});
