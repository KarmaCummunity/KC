export function karmaEventIcon(eventType: string): string {
  if (eventType.startsWith('closure') || eventType.startsWith('giving_handoff') || eventType === 'listing_fulfilled') return 'gift-outline';
  if (eventType.startsWith('follower')) return 'people-outline';
  if (eventType.startsWith('post')) return 'create-outline';
  if (eventType === 'outreach') return 'chatbubble-ellipses-outline';
  if (eventType === 'registration') return 'sparkles-outline';
  if (eventType === 'volunteer_checkin') return 'hand-left-outline';
  return 'star-outline';
}
