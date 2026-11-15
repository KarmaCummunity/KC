// Chat copy added with the move to the baseline messaging module (spec 07, FR-CHAT-003, FR-CHAT-007):
// the support thread has no named counterpart, and two refusals of a send get their own notice.
export const chatMessagingEn = {
  supportThreadTitle: 'Karma Community support',
  rateLimited: {
    title: 'Sending too fast',
    message: 'To keep the community safe, the number of messages per minute is limited. Try again in a moment.',
  },
  blocked: {
    title: 'Cannot send',
    message: 'This conversation is blocked, so messages cannot be sent.',
  },
} as const;
