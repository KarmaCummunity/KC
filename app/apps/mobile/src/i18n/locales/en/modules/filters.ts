// FR-FEED-004/005/006/018/020 — PostFilterSheet copy (header, section
// titles, sort/type/condition/status/source chips, location + radius).
// Extracted to a dedicated module per TD-156 incremental migration.
export const filtersEn = {
  header: 'Filter and sort',
  clearAll: 'Clear all',
  apply: 'Apply',
  searchPlaceholder: 'Search by title, description, or category…',
  searchClearA11y: 'Clear search',
  feedSettingsLink: 'Feed settings — what to hide',
  feedSettingsLinkA11y: 'Open feed settings — muted words, categories, and people',

  // Section titles
  sectionType: 'Post type',
  sectionWorld: 'Giving world',
  sectionSubcategory: 'Subcategory',
  sectionCategory: 'Category',
  sectionCondition: 'Item condition',
  sectionStatus: 'Post status',
  sectionSource: 'Post source',
  sectionSort: 'Sort',
  sectionLocation: 'Location',

  all: 'All',

  // Type chips
  typeGive: '🎁 Give',
  typeRequest: '🔍 Request',

  // Item conditions
  conditionNew: 'New',
  conditionLikeNew: 'Like new',
  conditionGood: 'Good',
  conditionFair: 'Fair',
  conditionDamaged: 'Broken/faulty',

  // Status filter
  statusOpenOnly: 'Open only',
  statusClosedOnly: 'Closed only',

  // Source filter
  followersOnly: '👥 Only people I follow',

  // Sort
  sortNewest: '🆕 Newest first',
  sortOldest: '🕓 Oldest first',
  sortDistance: '📍 By location',
  sortPersonalized: '✨ For you',
  sortDistanceCenterHint: 'Sort center (default: your city)',

  // Location
  allCities: 'All cities',
  radius: 'Range',
  radiusKm: '{{km}} km',
} as const;
