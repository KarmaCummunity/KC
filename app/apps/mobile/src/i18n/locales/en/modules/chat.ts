// FR-CHAT-016 — chat strings split from main bundle (TD-35 file-size budget).
export const chatEn = {
  title: 'Chats',
  noChats: 'No chats yet',
  noChatsDesc: 'Reach out to posters directly from their posts.',
  inputPlaceholder: 'Write a message...',
  attachImage: 'Attach image',
  mediaUploadFailed: 'Could not send the image. Try again.',
  typingIndicator: 'Typing…',
  onlineNow: 'Online now',
  send: 'Send',
  read: 'Read',
  report: 'Report chat',
  menuDeleteFromInbox: 'Remove from my inbox',
  hideFromInboxTitle: 'Remove this chat from your inbox?',
  hideFromInboxBody:
    'The chat will disappear only for you. The other side keeps the history. A new message in the same thread may bring it back to your list.',
  hideFromInboxCancel: 'Cancel',
  hideFromInboxConfirm: 'Remove',
  menuReport: 'Report this chat',
  minutesAgoShort: '{{count}} min ago',

  // InboxChatRow
  hideChatA11y: 'Remove chat from inbox',
  // Inbox preview prefixes — TD-110 bug 2.
  inboxSystemPrefix: '(system message)',
  inboxNewConversation: '(new conversation)',
  // Post-closure system messages (FR-CHAT-015 AC4-AC6, TD-148) — rendered from
  // system_payload; Hebrew matches the body the DB trigger (0031) stores.
  systemPostClosed: {
    deliveredToYou: 'Post marked as delivered ✓ · Thank you!',
    deliveredToOther: 'The post was delivered to another user',
    closedNotDelivered: 'The publisher closed the post — the item was not delivered',
  },

  // AnchoredPostCard (FR-CHAT-014/015)
  anchoredOpenA11y: 'Open the post',
  anchoredTypeGive: 'Giving',
  anchoredTypeRequest: 'Requesting',
  // AnchoredPostCard contact-phone quick-call (FR-CHAT-014 AC7)
  anchoredCallCounterpartA11y: 'Call {{phone}}',
  anchoredCallLabel: 'Call',

  // ReportChatModal (FR-CHAT-010)
  reportChatTitle: 'Report chat',
  reportChatNotePlaceholder: 'Description (optional, up to 500 characters)',
  reportChatDuplicateBody: 'You reported this chat in the last 24 hours.',
  reportChatSubmitting: '...',

  // Auto chat-message template — moved out of
  // application/chat/BuildAutoMessageUseCase.ts (Pattern #4). The wording
  // must match the use case's template exactly because contactPoster.ts
  // dedupes against the rendered string in the last 50 messages.
  autoMessage: {
    initial: 'Hi! I saw your post about {{title}}. I would love to talk.',
    rideInitial: 'Hi, I am reaching out about: {{title}}',
  },

  // Chat conversation screen (chat/[id].tsx) — PR5b i18n sweep.
  headerActionsA11y: 'Actions',
  errorTitle: 'Error',
  hideErrorSupport: 'The support chat cannot be removed.',
  hideErrorGeneric: 'We could not remove the chat. Please try again.',

  // Chat inbox screen (chat/index.tsx) — PR5b i18n sweep.
  searchPlaceholder: 'Search by name...',

  // ChatNotFoundView (components/chat/ChatNotFoundView.tsx) — PR5b i18n sweep.
  notFoundTitle: 'Chat unavailable',
  notFoundSubtitle: 'The chat may have been deleted or you may not have access to it.',
  notFoundBack: 'Back',
} as const;
