import { describe, it, expect } from 'vitest';
import { groupInboxByDay, notificationIcon } from '../notificationInboxView';

describe('notificationInboxView', () => {
  it('maps kinds to icons', () => {
    expect(notificationIcon('chat_message')).toBe('chatbubble-ellipses-outline');
    expect(notificationIcon('ride_booking_confirmed')).toBe('car-outline');
    expect(notificationIcon('follow_request')).toBe('person-add-outline');
    expect(notificationIcon('unknown')).toBe('notifications-outline');
  });
  it('groups into today and earlier', () => {
    const now = new Date(2026, 10, 2, 12, 0);
    const rows = [
      { id: 'a', createdAt: new Date(2026, 10, 2, 9).toISOString() },
      { id: 'b', createdAt: new Date(2026, 10, 1, 9).toISOString() },
    ];
    expect(groupInboxByDay(rows, now).map((i) => i.key)).toEqual(['h-today', 'a', 'h-earlier', 'b']);
  });
  it('omits empty sections', () => {
    expect(groupInboxByDay([], new Date())).toEqual([]);
  });
});
