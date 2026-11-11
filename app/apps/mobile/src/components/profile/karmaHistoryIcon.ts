// Ionicons name for a karma_ledger event type on the karma history screen (FR-KARMA-007).
const GIVING_EVENTS = new Set(['listing_fulfilled', 'item_value_bonus']);
const DONATION_EVENTS = new Set(['donation', 'standing_order_month']);

export function karmaEventIcon(eventType: string): string {
  if (eventType === 'reversal') return 'arrow-undo-outline';
  if (/^(closure|giving_handoff|handoff)_/.test(eventType) || GIVING_EVENTS.has(eventType)) return 'gift-outline';
  if (eventType.startsWith('challenge_')) return 'trophy-outline';
  if (DONATION_EVENTS.has(eventType)) return 'heart-outline';
  if (eventType.startsWith('follower')) return 'people-outline';
  if (eventType.startsWith('post')) return 'create-outline';
  if (eventType === 'outreach') return 'chatbubble-ellipses-outline';
  if (eventType === 'registration') return 'sparkles-outline';
  if (eventType === 'volunteer_checkin') return 'hand-left-outline';
  return 'star-outline';
}
