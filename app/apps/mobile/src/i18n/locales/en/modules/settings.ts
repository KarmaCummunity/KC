// FR-SETTINGS strings split from main bundle (TD-35 file-size budget).
export const settingsEn = {
  title: 'Settings',
  account: 'Account',
  accountDetails: 'Account details',
  notifications: 'Notifications',
  notificationsOn: 'Notifications enabled',
  privacy: 'Privacy',
  statsSection: 'Statistics',
  stats: 'Statistics',
  support: 'Support',
  legal: 'Legal',
  termsOfService: 'Terms of Service',
  privacyPolicy: 'Privacy Policy',
  about: 'About',
  aboutCard: {
    title: 'About Karma Community',
    subtitle: 'The vision, how it works, team, FAQ, and contact',
    cta: 'Learn more',
    a11y: 'About Karma Community — open the About page',
  },
  logout: 'Log out',
  loggingOut: 'Logging out...',
  deleteAccount: 'Delete account',
  deleteAccountModal: {
    title: 'Delete account',
    bullets: {
      posts: 'Your profile, posts and listings are hidden from everyone right away',
      follows: 'Your followers and following are kept for 30 days',
      moderation: 'The blocks and reports you submitted are kept for 30 days',
      donations: 'Donation links you set up are deleted after the 30 days',
      devices: 'All your connected devices will be disconnected',
    },
    chatsRetention:
      'Chats you had will remain with the people you talked to. They will see the messages you wrote, but not your name, photo, or profile — only "{{deletedUserLabel}}".',
    warning:
      'Your account is deactivated for 30 days. If you sign in again during that time you can restore it completely. After 30 days everything is deleted for good.',
    confirmInputLabel: 'Type "delete" to confirm',
    confirmInputPlaceholder: 'delete',
    confirmKeyword: 'delete',
    buttons: {
      cancel: 'Cancel',
      delete: 'Delete the account',
      retry: 'Try again',
      close: 'Close',
    },
    errors: {
      recoverable: 'Deletion failed — please try again',
      critical:
        'Deletion did not complete. Your posts and followers have already been deleted, but closing the account did not finish. You must tap "Try again" now — if you close the app, an invalid account will be created.',
    },
    blocked: {
      title: 'A suspended account cannot be deleted',
      body: 'Reach out for review through the reports screen.',
    },
    success: {
      title: 'Your account was deleted',
      subtitle: 'Thank you for being part of Karma.',
    },
  },
  privateProfileToggle: 'Private profile',
  activeStatusToggle: 'Show my active status',
  activeStatusHint: "When off, others won't see when you're online, and you won't see when they are.",
  followRequests: 'Follow requests',
  appearance: 'Appearance',
  appearanceScreen: {
    title: 'Appearance',
    intro: 'Choose how you want the app to look. You can follow your device settings or pick a fixed mode.',
    sectionMode: 'Display mode',
    modeSystemLabel: 'Automatic',
    modeSystemHint: 'Updates with your device (day/night).',
    modeLightLabel: 'Light',
    modeLightHint: 'Fixed day mode — warm and creamy.',
    modeDarkLabel: 'Dark',
    modeDarkHint: 'Fixed night mode — warm and dark, easy on the eyes.',
    previewLabel: 'Preview',
    previewHeading: 'Karma Community',
    previewBody: 'See how the colors look on a real screen.',
    previewPrimary: 'Give',
    previewSecondary: 'Request',
  },
  reportIssue: 'Report a problem',
  reportIssueScreen: {
    title: 'Report a problem',
    copy: 'Describe the problem and we will get back to you shortly.',
    categoryLabel: 'Category (optional)',
    categories: {
      Bug: 'Bug / issue',
      Account: 'Profile and login',
      Suggestion: 'Suggestion',
      Other: 'Other',
    } as Record<string, string>,
    descriptionLabel: 'Description (required)',
    descriptionPlaceholder: 'Describe the problem... (at least 10 characters)',
    descriptionMinLength: 'The description must contain at least 10 characters',
    submitBtn: 'Submit and open a chat',
    submitting: 'Submitting...',
    errorGeneric: 'Something went wrong. Please try again.',
    errorAdminNotFound: 'Support is unavailable. Please try again later.',
  },
  devTools: 'Developer tools',
  simulateHardRefresh: 'Simulate full refresh (debug)',
  simulatingHardRefresh: 'Refreshing...',
  version: 'KC - Karma Community',
  signOutFailed: 'Log out failed. Please try again.',

  // PR5d (UI sweep, Pattern #1) — Stack header title for /edit-profile.
  editProfileTitle: 'Edit profile',

  // Follow-requests inbox (FR-FOLLOW-007)
  followRequestsScreen: {
    headerTitle: 'Follower requests',
    empty: 'No pending requests.\nNew requests will appear here.',
    approve: 'Approve',
    reject: 'Decline',
    errorTitle: 'Error',
    errorMessage: 'The action failed. Please try again.',
  },

  // Privacy screen (FR-PROFILE-005 / FR-PROFILE-006)
  privacyScreen: {
    privateProfileLabel: 'Private profile',
    privateProfileHint: 'Only approved followers will see your posts and followers.',
    followRequestsLink: 'Follower requests',
    followRequestsLinkWithCount: 'Follower requests ({{count}})',
    confirmPrivateTitle: 'Make your profile private?',
    confirmPublicTitle: 'Make your profile public?',
    confirmPrivateMessage:
      'New follow requests will require approval. Existing followers will remain (you can remove them manually). Open posts will stay open. You can publish new posts to followers only.',
    confirmPublicMessage:
      'All pending requests will be approved automatically. Posts published to followers only will remain visible to every new follower from now on.',
    confirmPrivateCta: 'Make private',
    confirmPublicCta: 'Make public',
  },

  // Report-issue notify-modal title (FR-MOD-002 / FR-CHAT-007 AC3)
  reportIssueErrorTitle: 'Error',


  // FR-TRANSLATE-003 — translation language preference
  translationLanguage: 'Translation language',
  translationLanguageDeviceDefault: 'Device default',
  translationLanguageIntro:
    'Posts written in another language will be translated automatically to the language you choose. You can always view the original.',
  translationLanguageSaveFailed: 'Saving the translation language failed. Please try again.',
  translationLanguageNames: {
    he: 'Hebrew',
    en: 'English',
    ar: 'Arabic',
    ru: 'Russian',
  },

  // FR-SETTINGS-018 — app interface language (Hebrew ↔ English)
  language: 'App language',
  languageScreen: {
    title: 'App language',
    intro: 'Choose the interface language of the app.',
    optionHe: 'עברית',
    optionEn: 'English',
    restartNote: 'Changing the language will reload the app.',
    saveFailed: 'Changing the language failed. Please try again.',
    switchA11y: 'Change language / החלפת שפה',
  },
  whatsappRow: 'WhatsApp connection',
  whatsapp: {
    title: 'WhatsApp bot',
    intro: 'Link your WhatsApp number to your account to post and search through the bot. Available to Pro members.',
    notPro: 'The WhatsApp bot is available to Pro members only.',
    linked: 'Linked to {{number}}',
    notLinked: 'Not linked yet',
    getCode: 'Get a link code',
    codeLabel: 'Send this code to the bot on WhatsApp:',
    codeExpires: 'Valid until {{time}}',
    unlink: 'Unlink number',
    unlinkConfirm: 'Unlink your WhatsApp number from this account?',
    failed: 'Something went wrong. Please try again.',
  },
} as const;
