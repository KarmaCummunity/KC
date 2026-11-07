// FR-PROFILE / FR-FOLLOW strings extracted from the main bundle to keep
// `index.ts` under the 200-LOC cap as the profile surface grows (TD-156).
export const profileEn = {
  myProfile: 'My profile',
  editProfile: 'Edit profile',
  shareProfile: 'Share profile',
  followers: 'Followers',
  following: 'Following',
  activePosts: 'Active posts',
  closedPosts: 'Delivered posts',
  follow: 'Follow',
  following_btn: 'Following ✓',
  requestSent: 'Request sent ⏳',
  sendMessage: 'Send message',
  privateProfile: '🔒 This profile is private. Send a follow request to see posts.',

  // Follow button states + confirm dialogs (FR-FOLLOW-011)
  followCta: '+ Follow',
  followingActive: 'Following ✓',
  followRequestCta: '+ Send request',
  unfollowConfirmTitle: 'Unfollow?',
  unfollowConfirmCta: 'Unfollow',
  cancelRequestTitle: 'Cancel the follow request?',
  cancelRequestBody: 'You can send a new request anytime.',
  cancelRequestCta: 'Cancel request',
  cooldownRetryDays: 'You can send again in {{days}} days',
  followUnavailable: 'This user isn\'t available to follow right now',

  // Header / framing
  privateProfileA11y: 'Private profile',
  headerTitle: 'Profile',
  // FR-PROFILE / migration 0084 — fallbacks when a User row is in the
  // `pending_basic_info` transient window and `display_name` / `city_name`
  // are still NULL in the DB. Render sites use `value ?? t('profile.fallbackName')`
  // / `value ?? t('profile.cityNotSet')`.
  fallbackName: 'User',
  cityNotSet: '—',
  userNotFound: 'User not found',

  // Tabs
  tabOpen: 'Open posts',
  tabClosed: 'Closed posts',
  tabOpenWithCount: 'Open ({{count}})',
  tabClosedWithCount: 'Closed ({{count}})',

  // My Profile top-bar ⋮ (admin-removed posts — FR-POST-008 owner list)
  myProfileMenuA11y: 'Profile options',
  myProfileMenuHiddenPosts: 'Hidden',
  myProfileMenuRemovedPosts: 'Posts removed by an admin',
  hiddenBanner: 'These posts are shown only to you. They don\'t appear in the Open or Closed tabs on your profile.',
  hiddenSectionOpen: 'Open posts',
  hiddenSectionClosed: 'Closed posts',
  emptyHiddenOpenTitle: 'No hidden open posts',
  emptyHiddenOpenSubtitle: 'When you publish a post shown only to you, it will appear here.',
  emptyHiddenClosedTitle: 'No hidden closed posts',
  emptyHiddenClosedSubtitle: 'Hidden posts you\'ve closed will appear here.',
  myProfileMenuSavedPosts: 'Saved',
  savedBanner: 'Posts you\'ve saved. If a post is no longer available (deleted, removed, or made private again), it won\'t appear here.',
  savedSectionOpen: 'Open posts',
  savedSectionClosed: 'Closed posts',
  emptySavedOpenTitle: 'No open posts saved',
  emptySavedOpenSubtitle: 'Save an open post from the feed to see it here.',
  emptySavedClosedTitle: 'No closed posts saved',
  emptySavedClosedSubtitle: 'Closed posts you\'ve saved will appear here.',

  // Stats row
  statsPostsLabel: 'Posts',

  // Empty states
  emptyOpenTitle: 'No open posts',
  emptyClosedTitle: 'No closed posts',
  emptyClosedTitleSelf: 'No closed posts yet',
  emptySelfOpenSubtitle: 'Publish your first post!',
  emptySelfClosedSubtitle: 'Posts you\'ve closed or received will appear here.',
  emptySelfClosedSubtitleLegacy: 'Posts you\'ve marked as delivered will appear here.',
  emptyOtherOpenSubtitle: 'This user hasn\'t posted anything yet.',
  emptyOtherClosedSubtitle: 'This user hasn\'t closed or received a post yet.',
  emptyOtherClosedSubtitleLegacy: 'This user hasn\'t completed a delivery yet.',
  followCooldownTitle: 'Can\'t send right now',
  followCooldownDays: 'You can send again in {{count}} days.',
  followErrorTitle: 'Error',
  followErrorMessage: 'The action failed. Please try again.',

  // Avatar editor (EditProfileAvatar — FR-PROFILE-007)
  avatarChangeA11y: 'Change profile photo',
  avatarAddA11y: 'Add profile photo',
  avatarChangeHint: 'Change photo',
  avatarAddHint: 'Add photo',
  avatarUploadFailedTitle: 'Photo upload failed',
  avatarUploadRetry: 'Please try again.',

  // PhotoSourceSheet (FR-AUTH-011 AC1)
  photoSourceTitle: 'Profile photo',
  photoSourceCameraOption: '📷  Take a photo',
  photoSourceCameraA11y: 'Take a photo with the camera',
  photoSourceGalleryOption: '🖼️  Choose from gallery',
  photoSourceGalleryA11y: 'Choose from gallery',
  photoSourceRemoveOption: '🗑️  Remove photo',
  photoSourceRemoveA11y: 'Remove the current photo',

  // CityPicker (FR-AUTH-010 AC2 — also reused by EditProfileAddressBlock)
  cityPickerTitle: 'Choose a city',
  cityPickerSearchPlaceholder: 'Search for a city...',
  cityPickerError: 'Error loading the city list. Please try again.',
  cityPickerEmpty: 'No matching cities found.',
  cityPickerCloseA11y: 'Close',

  // StreetPicker (FR-PROFILE-007 AC1 — city-dependent canonical streets)
  streetPickerTitle: 'Choose a street',
  streetPickerSearchPlaceholder: 'Search for a street...',
  streetPickerError: 'Error loading the street list. Please try again.',
  streetPickerEmpty: 'No matching streets found.',
  streetPickerNeedCity: 'Choose a city first',
  streetPickerUseMyText: 'Use "{{value}}"',

  // EditProfileAddressBlock
  addressLabel: 'Address',
  streetNumberShort: 'No.',

  // Removed-tab banner (FR-POST-008 owner-view of removed_admin posts)
  removedBanner: 'These posts were removed by a community admin. They\'re visible only to you.',
  removedSectionOpen: 'Posts that were open',
  removedSectionClosed: 'Posts that were closed',
  emptyRemovedOpenTitle: 'No open posts removed',
  emptyRemovedOpenSubtitle: 'Open posts removed by an admin will appear here.',
  emptyRemovedClosedTitle: 'No closed posts removed',
  emptyRemovedClosedSubtitle: 'Closed posts removed by an admin will appear here.',

  // Edit Profile screen (FR-PROFILE-007)
  editScreen: {
    loadFailedTitle: 'Loading failed',
    saveFailedTitle: 'Saving failed',
    unknownError: 'Unknown error',
    unsavedChangesTitle: 'You have unsaved changes',
    unsavedChangesMessage: 'If you leave now, your changes will be lost. Leave anyway?',
    unsavedChangesDiscard: 'Leave without saving',
    unsavedChangesCancel: 'Cancel',
    invalidNameTitle: 'Invalid name',
    invalidNameMessage: 'Please enter a name between 1 and 50 characters.',
    missingCityTitle: 'City missing',
    missingCityMessage: 'Please choose a city.',
    incompleteAddressTitle: 'Incomplete address',
    incompleteAddressMessageNumber: 'Please add a house number too, or clear the street name.',
    incompleteAddressMessageStreet: 'Please add a street name, or clear the house number.',
    fullNameLabel: 'Full name',
    fullNamePlaceholder: 'e.g., Rina Cohen',
    contactPhoneLabel: 'Contact phone',
    contactPhoneHelper: 'Required for the “complete profile” badge (not phone verification).',
    contactPhonePlaceholder: 'e.g., 050-1234567',
    completeProfileCardTitle: 'Missing details for the complete-profile badge',
    completeProfileCardBody: 'Fill in the items below and save — a green check appears next to your name.',
    completeField: {
      bullet: '• {{field}}',
      displayName: 'Full name',
      city: 'City',
      dateOfBirth: 'Date of birth (private)',
      avatarUrl: 'Profile photo',
      profileStreet: 'Street',
      profileStreetNumber: 'House number',
      contactPhone: 'Contact phone',
    },
    invalidContactPhoneTitle: 'Invalid phone number',
    invalidContactPhoneMessage: 'Enter up to 20 characters.',
    biographyLabel: 'Biography (optional)',
    biographyPlaceholder: 'A bit about you — no links',
    save: 'Save',
  },

  // Other user's profile (FR-PROFILE-002..004)
  otherScreen: {
    headerTitle: 'Profile',
    userNotFound: 'User not found',
    sendMessage: 'Send message',
  },

  // Followers list (FR-PROFILE-009 / FR-PROFILE-010)
  followersScreen: {
    headerTitle: 'Followers',
    searchPlaceholder: 'Search by name',
    empty: 'No results',
    removeFollowerTitle: 'Remove follower?',
    removeFollowerMessage:
      '{{name}} will no longer see followers-only posts, and won\'t be notified. If your profile is public, they can follow you again immediately; if it\'s private, they\'ll need to send a request.',
    removeFollowerConfirm: 'Remove',
  },

  // Following list (FR-PROFILE-010)
  followingScreen: {
    headerTitle: 'Following',
    searchPlaceholder: 'Search by name',
    empty: 'No results',
  },
} as const;
