import { marketplaceMap } from './marketplaceMap';
// English — Donations hub + Search tab (D-16, FR-DONATE-001..009, FR-FEED-016).
// Locale file under `locales/en/`; composed into the bundle via `locales/en/index.ts`.
// Rides strings (FR-RIDE-*) live in `donations.rides.ts` (architecture file-size cap).
import { rides } from './donations.rides';
import { marketplaceErrors } from './donations.marketplaceErrors';
import { marketplaceBrowseRefine, marketplaceWorldLabels } from './donations.marketplaceExtras';
import { marketplaceAvailabilityLabels, marketplaceFieldLabels, marketplaceListingStatusLabels, marketplaceOptionLabels } from './donations.marketplaceFields';
import { worldLaunch } from './donations.worldLaunch';
import { marketplaceMyListings } from './donations.myListings';
import { worldsHub } from './donations.worldsHub';
import { worldFeed } from './donations.worldFeed';
export { moneyPayments } from './donations.moneyPayments';
export { timeVolunteer } from './donations.timeVolunteer';

export const donations = {
  tabLabel: 'Donations',
  hubTitle: 'Donations by:',
  hubHeroTitle: 'Give. Receive. Donate what you have.',
  hubHeroSubtitle: 'Pick a cause that speaks to you and turn it into action.',
  hubItemsFeaturedTitle: 'Items',
  hubItemsFeaturedSubtitle: 'Donate and request items — the core action in the app',
  hubCategoriesSectionTitle: 'More donation categories',
  worldLaunch,
  worldsHub,
  worldFeed,
  items: { title: 'Items', subtitle: 'Donate and request items' },
  time: { title: 'Time', subtitle: 'Volunteering and free time' },
  money: { title: 'Money', subtitle: 'Monetary donation' },
  // FR-DONATE-006 — six new categories.
  categories: {
    food: {
      title: 'Food',
      subtitle: 'Food distribution nonprofits',
      body:
        'The food category is coming soon.\nUntil then, we invite you to donate to the community itself and help us grow and develop.\nIn the meantime, you can find nonprofits for food, food saving, and distribution — in the links below.',
    },
    housing: {
      title: 'Housing',
      subtitle: 'Housing and shelter',
      body:
        'The housing category is coming soon.\nUntil then, we invite you to donate to the community itself and help us grow and develop.\nIf you would like to support housing, rehabilitation, and shelter organizations — check out the links below.',
    },
    transport: {
      title: 'Transport',
      subtitle: 'Rides and accompaniment',
      body:
        'The transport category is coming soon.\nUntil then, we invite you to donate to the community itself and help us grow and develop.\nFor rides, accompaniment, and mobility for people who need it — choose from the links below.',
    },
    knowledge: {
      title: 'Knowledge',
      subtitle: 'Lessons, mentoring, and training',
      body:
        'The knowledge category is coming soon.\nUntil then, we invite you to donate your profession to the community and help us develop.\nFor lessons, mentoring, and training in places that suit you — visit one of the links below.',
    },
    animals: {
      title: 'Animals',
      subtitle: 'Rescuing and caring for animals',
      body:
        'The animals category is coming soon.\nUntil then, we invite you to donate to the community itself and help us grow and develop.\nIf you would like to support animal rescue and care — check out the links below.',
    },
    medical: {
      title: 'Medical',
      subtitle: 'Medical support and equipment',
      body:
        'Blood donation, the ADI organ donor card, first aid and medical equipment — find the leading organizations in Israel here.\nPick one, visit its site and help save lives.',
    },
  },
  moneyScreen: {
    title: 'Monetary donation',
    body:
      'Support Karma Community directly, find nonprofits to donate to, and share links to nonprofits you know.',
    openLink: 'Open jgive.com',
    linkErrorTitle: 'We couldn’t open the link',
    linkErrorBody: 'Try a different browser or enter the address manually.',
  },
  timeScreen: {
    title: 'Time donation',
    body:
      'The time donation category is coming soon.\nUntil then, we invite you to explore volunteering opportunities on the Lev Echad platform, or through any of the links below.',
    openLink: 'Open Lev Echad',
    composerHeading: 'You can also volunteer directly with our organization and help this community grow! \nLeave a message and we’ll get back to you.',
    composerPlaceholder: 'Type your message — profession, area of interest, and availability...',
    sendButton: 'Send message',
    sendError: 'Not sent. Try again.',
    sendRetry: 'Try again',
    volunteerPrefix: 'Volunteering with the organization: ',
  },
  // FR-DONATE-007/008/009 — community-curated NGO link list.
  links: {
    sectionTitle: 'Nonprofits and links',
    addButtonA11y: 'Add link',
    empty: {
      title: 'No links added yet',
      body: 'The easiest way to start — add the first link.',
      cta: 'Add the first link',
    },
    loading: 'Loading...',
    loadError: 'We couldn’t load the links. Try again.',
    retry: 'Try again',
    rowMenu: {
      open: 'Open',
      report: 'Report link',
      edit: 'Edit',
      remove: 'Delete',
    },
    reportSent: 'Thanks, your report was received.',
    confirmRemoveTitle: 'Delete link',
    confirmRemoveBody: 'The link will be hidden from the list. Continue?',
    confirmRemoveOk: 'Delete',
    confirmRemoveCancel: 'Cancel',
  },
  // FR-DONATE-010 — platform-support CTA card embedded on About + Settings.
  supportUs: {
    title: 'Giving with love? Give to the community too',
    tagline:
      'Karma is a free community that runs on your love and generosity. Every donation helps us keep building a place of giving for everyone.',
  },
  // FR-RIDE-001..045 — hitchhiking (rides V3.0). Strings live in donations.rides.ts.
  rides,
  knowledge: {
    hubBody: 'Offer mentoring or lessons, book a slot, then complete and rate. Learning organisations are listed below.',
  },
  addLinkModal: {
    title: 'Add a new link',
    editTitle: 'Edit link',
    urlLabel: 'Link (URL)',
    urlPlaceholder: 'https://...',
    nameLabel: 'Display name',
    namePlaceholder: 'Nonprofit / group name',
    descriptionLabel: 'Description (optional)',
    descriptionPlaceholder: 'What can be found in this link?',
    cancel: 'Cancel',
    submit: 'Add',
    save: 'Save',
    submitting: 'Verifying link...',
    helperText: 'The link will be checked for validity before it’s added.',
    editHelperText: 'Your changes will be verified against the server before saving.',
    errors: {
      invalid_url: 'The link is invalid. Make sure it starts with http or https.',
      invalid_input: 'Please make sure all fields are filled in correctly.',
      unreachable: 'The link didn’t open. It may not be active.',
      rate_limited: 'You’ve added a lot of links in a short time. Try again in an hour.',
      unauthorized: 'You need to sign in to add a link.',
      forbidden: 'You don’t have permission to edit this link.',
      network: 'Network issue. Try again.',
      unknown: 'Unexpected error. Try again.',
    },
  },
} as const;

export const search = {
  tabLabel: 'Search',
  title: 'Search',
  placeholder: 'Search people, posts, links...',

  // Category chips
  all: 'All',
  posts: 'Posts',
  people: 'People',
  links: 'Links',
  orgs: 'Organizations',
  hashtags: 'Hashtags',

  // Sort options
  sortBy: 'Sort by',
  sortRelevance: 'Relevance',
  sortNewest: 'Newest',
  sortFollowers: 'Followers',

  // Filter
  filters: 'Filters',
  filterCity: 'City',
  filterPostType: 'Post type',
  filterCategory: 'Category',
  filterDonationCategory: 'Donation category',
  filterMinFollowers: 'Minimum followers',
  filterRadius: 'Radius from city',
  radiusKm: 'Up to {km} km',
  clearFilters: 'Clear filters',
  applyFilters: 'Apply filters',

  // Results sections
  sectionPeople: 'People',
  sectionPosts: 'Posts',
  sectionLinks: 'Links',
  sectionOrgs: 'Organizations',
  sectionHashtags: 'Hashtags',
  suggested: 'Suggested searches',
  showAll: 'Show all',

  // Result info
  followers: '{{count}} followers',
  givenItems: '{{count}} items given',
  inCategory: 'In {{category}} category',

  // States
  noResults: 'No results found',
  noResultsDesc: 'Try different search terms or change the filters.',
  recentSearches: 'Recent searches',
  clearRecent: 'Clear history',
  startSearching: 'Start searching',
  startSearchingDesc: 'Search people, posts, and links across the whole community.',
  minChars: 'Type at least 2 characters',
  loading: 'Searching...',
  nationalLinks: 'Showing national links',
  give: 'Give',
  request: 'Request',
  giveBadge: '🎁 Give',
  requestBadge: '🔍 Request',

  // Post categories for filter
  categories: {
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


  // Donation categories for filter
  donationCategories: {
    time: 'Time',
    money: 'Money',
    food: 'Food',
    housing: 'Housing',
    transport: 'Transport',
    knowledge: 'Knowledge',
    animals: 'Animals',
    medical: 'Medical',
  },
} as const;

export const marketplace = {
  ...marketplaceMap,
  allWorlds: 'All worlds',
  loading: 'Loading…',
  empty: 'No listings match your filters.',
  clusterLabel: '{{count}} listings',
  notFound: 'Listing not found.',
  startChat: 'Message publisher',
  shareFeed: 'Share to feed',
  actionFailed: 'That did not go through. Please try again.',
  chatOpener: 'Hi — I saw your listing on the marketplace.',
  fieldTitle: 'Title',
  fieldSummary: 'Summary',
  publishing: 'Publishing…',
  forYouTitle: 'For you',
  fieldWorldSubcategory: 'Subcategory',
  fieldWorldSubcategoryHint: 'Optional — helps us find matches for you',
  validationFailed: 'Please check the form ({{code}}).',
  errors: marketplaceErrors,
  shareLink: 'Share link',
  report: 'Report listing',
  reportTitle: 'Report this listing',
  similarTitle: 'Similar listings',
  anonymousOwner: 'Community member',
  profileListingsTitle: 'Marketplace listings',
  profileListingsEmpty: 'No public listings yet.',
  statusClosed: 'Fulfilled',
  ...marketplaceMyListings,
  world: marketplaceWorldLabels,
  browseRefine: marketplaceBrowseRefine,
  field: marketplaceFieldLabels,
  option: marketplaceOptionLabels,
  availability: marketplaceAvailabilityLabels,
  listingStatus: marketplaceListingStatusLabels,
} as const;
