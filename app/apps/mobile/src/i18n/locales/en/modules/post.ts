// FR-POST strings split from main bundle (TD-35 file-size budget).
// `editPost` lives in postEdit.ts; menu/report in their own modules.
// TD-117 closed by extracting editPost into postEdit.ts.
import { postMenuEn } from './postMenu';
import { postReportEn } from './postReport';
import { postEditEn } from './postEdit';
import { postUnifiedCreateEn } from './postUnifiedCreate';

export const postEn = {
  ...postMenuEn,
  ...postReportEn,
  ...postEditEn,
  ...postUnifiedCreateEn,
  give: 'Give an item',
  request: 'Request an item',
  title: 'Title',
  titlePlaceholder: 'What are you giving/requesting?',
  description: 'Description (optional)',
  descPlaceholder: 'More details about the item...',
  urgency: 'Urgency (optional)',
  urgencyPlaceholder: 'e.g., needed by Friday',
  photos: 'Photos',
  addPhoto: 'Add photo',
  removePhoto: 'Remove photo',
  sendMessageA11y: 'Message the poster',
  address: 'Address',
  cityLabel: 'City',
  streetLabel: 'Street',
  streetNumberLabel: 'Number',
  locationDisplay: 'What to show in the feed',
  cityOnly: 'City only',
  cityAndStreet: 'City + street',
  fullAddress: 'Full address',
  visibility: 'Who can see the post',
  visibilityPublic: '🌍 Everyone',
  visibilityFollowers: '👥 My followers only',
  visibilityOnlyMe: '🔒 Only me',
  publish: 'Publish',
  draft: 'Save draft',
  publishSuccess: 'Your post is live!',
  draftRestored: 'You have an unpublished draft',
  draftRestoredBody: 'You started a post but never published it. Continue where you left off or start over?',
  draftMissingImage: 'The image is unavailable — add it again.',
  continueDraft: 'Keep editing',
  discardDraft: 'Start over',
  sendMessage: '💬 Message the poster',
  followAuthor: 'Follow the poster',
  report: 'Report',
  markDelivered: 'Mark as delivered',
  edit: 'Edit',
  delete: 'Delete',
  reopen: '📤 Reopen',
  conditionNew: 'New',
  conditionLikeNew: 'Like new',
  conditionGood: 'Good',
  conditionFair: 'Fair',
  photoRequired: 'A photo is required for a "Give" post',
  maxPhotos: 'Maximum {{max}} photos',
  maxPosts: 'You reached the maximum of 20 active posts',
  imageZoom: 'Zoom in',
  imageZoomNth: 'Zoom in on photo {{index}} of {{total}}',
  imageViewerClose: 'Close photo viewer',

  // FR-POST-003 — LocationDisplayLevelChooser (publish-address granularity)
  locationDisplayLabel: 'Address display',
  locationDisplayCityAndStreet: 'City and street',
  locationDisplayHintCityOnly: 'Maximum anonymity',
  locationDisplayHintCityAndStreet: 'Recommended',
  locationDisplayHintFullAddress: 'Includes house number',

  // PhotoPicker
  photosRequiredSuffix: '* (required for "Give")',
  photosHint: 'Choose up to {{max}} photos from your gallery.',

  // VisibilityChooser sub-labels (FR-POST-003)
  visibilityPublicSub: 'The post appears in the main feed for all users',
  visibilityFollowersSub: 'The post is shown only to your approved followers',
  visibilityOnlyMeSub: 'The post is saved privately; you can make it public when editing',
  // FR-POST-003 AC5 — public profile: Followers-only row hint (tooltip copy as subtitle).
  visibilityFollowersLockedSub: 'Available on a private profile. Settings → Privacy.',
  deleteError: 'Deletion failed, please try again.',
  deleteSuccess: 'The post was deleted.',
  adminRemoveError: 'Removal failed, please try again.',
  adminRemoveSuccess: 'The post was removed.',

  // Category labels — keys match the `Category` enum so callers do
  // `t(\`post.category.${cat}\`)`. Moved out of domain/value-objects.ts
  // per the Hebrew→i18n migration (Pattern #2).
  category: {
    Furniture: 'Furniture',
    Clothing: 'Clothing',
    Books: 'Books',
    Toys: 'Toys',
    BabyGear: 'Baby gear',
    Kitchen: 'Kitchen',
    Sports: 'Sports',
    Electronics: 'Electronics',
    Tools: 'Tools',
    Other: 'Other',
  },

  // Item-condition labels — keys match the `ItemCondition` enum so callers
  // do `t(\`post.condition.${cond}\`)`. Moved out of domain/value-objects.ts.
  condition: {
    New: 'New',
    LikeNew: 'Like new',
    Good: 'Good',
    Fair: 'Fair',
    Damaged: 'Broken/faulty',
  },

  // PR5d (UI sweep, Pattern #1) — header titles + create-screen literals
  // not covered by the existing keys above. Add a new key only when no
  // sibling already covers the exact Hebrew string.
  detailTitle: 'Post details',
  streetNumberShort: 'No.',
  // FR-KARMA-004 — compact estimated-value hint shown on the feed post card (Give posts).
  estimatedValueBadge: 'Est. value ₪{{value}}',
  categoryLabel: 'Category',
  conditionLabel: 'Item condition',
  reauthRequired: 'Please sign in again before publishing a post.',
  uploadFailedTitle: 'Photo upload failed',
  uploadRetry: 'Please try again.',
  uploadPartial: '{{ok}}/{{total}} uploaded — retry the rest.',
  networkError: 'Network error. Please try again.',
  publishFailed: 'Publishing failed: {{message}}',

  // FR-POST-006 AC2 — publish with Followers-only visibility (create flow).
  publishFollowersTitle: 'Publish to approved followers only?',
  publishFollowersBody:
    'The post will appear in the feed of up to {{count}} approved followers (per your profile count).',
  publishFollowersConfirmCta: 'Followers only',
  publishFollowersMakePublicCta: 'Make public',

  /** Collapsible block on create post — address display, visibility, partner-surface mask. */
  exposureSettingsSectionTitle: 'Exposure settings',
  exposureSettingsIntro:
    'Choose what appears in the feed here. The full address is required to publish, but it doesn\'t have to be visible to everyone.',
  menuExposureClosedHint:
    'Closed post: set who can see the card on the counterpart\'s profile here (separate from feed visibility).',
  menuExposureSaving: 'Saving…',

  /** FR-POST-021 + D-31 — third-party viewers on the partner's closed-post profile (not the partner in chat). */
  counterpartyMaskLabel: 'Hide my identity from others viewing the counterpart\'s "Closed posts"',
  createCounterpartyPrivacyTitle: 'Who sees me next to the post on the counterpart\'s profile?',
  createCounterpartyPrivacyHint:
    'In chat, the counterpart already sees who you are. This is about third-party users who open the closed-posts list on the counterpart\'s profile — they won\'t see your name and photo on the post card. In the feed and elsewhere, it follows the visibility settings above.',

  // Post detail screen (post/[id].tsx) — PR5b i18n sweep.
  detail: {
    loadErrorTitle: 'Error loading the post',
    retry: 'Try again',
    notFoundTitle: 'Post not found',
    notFoundSubtitle: 'It may have been closed, or you may not have permission to view it.',
    streetPrefix: 'Street',
    // FR-POST-023 — share post via link (P2.33).
    shareA11y: 'Share the post',
    shareDialogTitle: 'Share post',
    shareHeadlineGiveOpen: '🎁 An item waiting for a new home on Karma Community',
    shareHeadlineGiveClosed: '✅ An item successfully delivered on Karma Community',
    shareHeadlineRequestOpen: '🔍 A request for help from Karma Community',
    shareHeadlineRequestClosed: '✅ A request that was answered on Karma Community',
    shareLabelTitle: 'Title:',
    shareLabelDescription: 'Description:',
    shareLabelCategory: 'Category:',
    shareLabelLocation: 'Location:',
    shareLabelPostedAt: 'Posted:',
    shareLabelStatus: 'Status:',
    shareLabelPublisher: 'Poster:',
    shareLabelCounterparty: 'Partner:',
    shareCtaGiveOpen: 'Maybe it\'s just right for you — tap for details 👇',
    shareCtaGiveClosed: 'To view the delivery details — tap here 👇',
    shareCtaRequestOpen: 'If you can help — tap for details 👇',
    shareCtaRequestClosed: 'To view the request details — tap here 👇',
    shareCopiedToast: 'Link copied',
    shareFailedToast: 'Sharing failed, please try again.',
    typeGiveLabel: 'Give',
    typeRequestLabel: 'Request',
    conditionPrefix: 'Condition: ',
    urgencyPrefix: '⚡ Urgency: ',
    contactA11y: 'Message the poster',
    contactOpeningA11y: 'Opening a chat with the poster',
    contactCta: 'Message the poster',
    anonymousUser: 'Anonymous',
    statusOpen: 'Active',
    statusOpenHint: 'The post is open and looking for a match',
    statusClosed: 'Completed',
    statusPendingDelete: 'Temporarily closed',
    statusExpired: 'Expired',
    statusRemovedAdmin: 'Removed',
    publishedBy: 'Posted by',
    // Visibility + lifecycle notices shown to anyone who can still see the post.
    removedAdminNotice: 'The post was removed by an admin and is no longer shown in the feed.',
    statusHiddenForReview: 'Hidden for review',
    hiddenForReviewNotice: 'The post was hidden after reports and is waiting for a team review. Others cannot see it meanwhile.',
    expiredNotice: 'The post has expired and is no longer active.',
    visibilityFollowersNotice: 'This post is visible to approved followers only.',
    visibilityOnlyMeNotice: 'Private post — visible only to its owner.',
  },

  // FR-TRANSLATE-003 — translation reader UX
  translating: 'Translating…',
  showOriginal: 'Show original',
  showTranslation: 'Show translation',
  autoTranslated: 'Auto-translated',

  engagement: {
    title: 'Engagement',
    meta: '{{reactions}} reactions · {{comments}} comments',
    commentPlaceholder: 'Write a comment…',
    commentSend: 'Post comment',
    reaction: {
      like: 'Like',
      support: 'Support',
      thanks: 'Thanks',
    },
  },
} as const;
