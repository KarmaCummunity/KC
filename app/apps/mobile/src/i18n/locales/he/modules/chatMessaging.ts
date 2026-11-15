// Chat copy added with the move to the baseline messaging module (spec 07, FR-CHAT-003, FR-CHAT-007):
// the support thread has no named counterpart, and two refusals of a send get their own notice.
export const chatMessagingHe = {
  supportThreadTitle: 'תמיכת קהילת קארמה',
  rateLimited: {
    title: 'שולחים מהר מדי',
    message: 'כדי לשמור על הקהילה אפשר לשלוח מספר מוגבל של הודעות בדקה. נסו שוב בעוד רגע.',
  },
  blocked: {
    title: 'אי אפשר לשלוח',
    message: 'השיחה הזאת חסומה ולכן אי אפשר לשלוח בה הודעות.',
  },
} as const;
