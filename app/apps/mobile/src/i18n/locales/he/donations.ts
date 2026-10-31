import { marketplaceMap } from './marketplaceMap';
// Hebrew — Donations hub + Search tab (D-16, FR-DONATE-001..009, FR-FEED-016).
// Locale file under `locales/he/`; composed into the bundle via `locales/he/index.ts`.
// Rides strings (FR-RIDE-*) live in `donations.rides.ts` (architecture file-size cap).
import { rides } from './donations.rides';
import { marketplaceErrors } from './donations.marketplaceErrors';
import { marketplaceBrowseRefine, marketplaceOrgPicker, marketplaceWorldLabels } from './donations.marketplaceExtras';
import { marketplaceAvailabilityLabels, marketplaceFieldLabels, marketplaceListingStatusLabels, marketplaceOptionLabels } from './donations.marketplaceFields';
import { worldLaunch } from './donations.worldLaunch';
import { worldsHub } from './donations.worldsHub';
export { moneyPayments } from './donations.moneyPayments';
export { timeVolunteer } from './donations.timeVolunteer';

export const donations = {
  tabLabel: 'תרומות',
  hubTitle: 'תרומות של:',
  hubHeroTitle: 'לתת. לקבל. לתרום מה שיש לך.',
  hubHeroSubtitle: 'לבחור תחום שמדבר אלינו ולהפוך אותו לפעולה.',
  hubItemsFeaturedTitle: 'חפצים',
  hubItemsFeaturedSubtitle: 'תרומה ובקשת חפצים — הפעולה המרכזית באפליקציה',
  hubCategoriesSectionTitle: 'תחומי תרומה נוספים',
  worldLaunch,
  worldsHub,
  items: { title: 'חפצים', subtitle: 'תרומה ובקשת חפצים' },
  time: { title: 'זמן', subtitle: 'התנדבות וזמן פנוי' },
  money: { title: 'כסף', subtitle: 'תרומה כספית' },
  // FR-DONATE-006 — six new categories.
  categories: {
    food: {
      title: 'אוכל',
      subtitle: 'עמותות חלוקת מזון',
      body:
        'קטגוריית האוכל תיפתח בהמשך.\nועד אז מזמינים אתכם ללתרום לקהילה עצמה, ולעזור לנו לגדול ולהתפתח.\nבינתיים אפשר למצוא עמותות למזון, לחיסכון במזון ולחלוקה — בקישורים למטה.',
    },
    housing: {
      title: 'דיור',
      subtitle: 'דיור ושיכון',
      body:
        'קטגוריית הדיור תיפתח בהמשך.\nועד אז מזמינים אתכם ללתרום לקהילה עצמה, ולעזור לנו לגדול ולהתפתח.\nאם בא לכם לתמוך בארגוני דיור, שיקום ושיכון — עברו על הקישורים למטה.',
    },
    transport: {
      title: 'תחבורה',
      subtitle: 'הסעות וליווי',
      body:
        'קטגוריית התחבורה תיפתח בהמשך.\nועד אז מזמינים אתכם ללתרום לקהילה עצמה, ולעזור לנו לגדול ולהתפתח.\nלהסעות, ליווי וניידות לאנשים שזקוקים לזה — בחרו מהקישורים למטה.',
    },
    knowledge: {
      title: 'ידע',
      subtitle: 'שיעורים, חניכה והכשרה',
      body:
        'קטגוריית הידע תיפתח בהמשך.\nועד אז מזמינים אתכם לתרום מהמקצוע שלכם לקהילה, ולעזור לנו להתפתח.\nלשיעורים, חניכה והכשרה במקומות שמתאימים לכם — היכנסו לאחד הקישורים למטה.',
    },
    animals: {
      title: 'חיות',
      subtitle: 'הצלת חיות וטיפול בהן',
      body:
        'קטגוריית החיות תיפתח בהמשך.\nועד אז מזמינים אתכם ללתרום לקהילה עצמה, ולעזור לנו לגדול ולהתפתח.\nאם בא לכם לתמוך בהצלת בעלי חיים ובטיפול בהם — עברו על הקישורים למטה.',
    },
    medical: {
      title: 'רפואה',
      subtitle: 'תמיכה רפואית וציוד',
      body:
        'תרומת דם, כרטיס אדי, עזרה ראשונה וציוד רפואי — כאן תמצאו את הגופים המובילים בישראל.\nבחרו גוף, היכנסו לאתר שלו ותצילו חיים.',
    },
  },
  moneyScreen: {
    title: 'תרומה כספית',
    body:
      'כאן אפשר לתמוך ישירות בקהילת קארמה, למצוא עמותות לתרומה ולשתף קישורים לעמותות שאתם מכירים.',
    openLink: 'לפתוח את jgive.com',
    linkErrorTitle: 'לא הצלחנו לפתוח את הקישור',
    linkErrorBody: 'נסו דפדפן אחר או הקלידו את הכתובת ידנית.',
  },
  timeScreen: {
    title: 'תרומת זמן',
    body:
      'קטגוריית תרומת הזמן תפתח בקרוב.\nועד אז מזמינים אתכם להיכנס ולמצוא הזדמנויות התנדבות בפלטפורמה של ׳לב אחד׳, או בכל אחד מהקישורים פה למטה.',
    openLink: 'לפתוח את לב אחד',
    composerHeading: 'ניתן גם להתנדב ישירות בארגון שלנו, ולעזור לקהילה הזאת להפתח! \nהשאירו הודעה ונחזור אליכם.',
    composerPlaceholder: 'הקלידו את ההודעה שלכם — מקצוע, תחום עניין, וזמינות...',
    sendButton: 'לשלוח הודעה',
    sendError: 'לא נשלח. נסו שוב.',
    sendRetry: 'לנסות שוב',
    volunteerPrefix: 'התנדבות בארגון: ',
  },
  // FR-DONATE-007/008/009 — community-curated NGO link list.
  links: {
    sectionTitle: 'עמותות וקישורים',
    addButtonA11y: 'הוספת קישור',
    empty: {
      title: 'עוד לא הוספו קישורים',
      body: 'הכי קל להתחיל — הוסיפו את הקישור הראשון.',
      cta: 'הוספת קישור ראשון',
    },
    loading: 'טוען...',
    loadError: 'לא הצלחנו לטעון את הקישורים. נסו שוב.',
    retry: 'לנסות שוב',
    rowMenu: {
      open: 'לפתוח',
      report: 'לדווח על קישור',
      edit: 'לערוך',
      remove: 'למחוק',
    },
    reportSent: 'תודה, הדיווח התקבל.',
    confirmRemoveTitle: 'מחיקת קישור',
    confirmRemoveBody: 'הקישור יוסתר מהרשימה. להמשיך?',
    confirmRemoveOk: 'למחוק',
    confirmRemoveCancel: 'ביטול',
  },
  // FR-DONATE-010 — platform-support CTA card embedded on About + Settings.
  supportUs: {
    title: 'תורמים באהבה? תרמו גם לקהילה',
    tagline:
      'קארמה היא קהילה חופשית שרצה על האהבה והנדיבות שלכם. כל תרומה עוזרת לנו להמשיך לבנות מקום של נתינה לכולם.',
  },
  // FR-RIDE-001..045 — hitchhiking (rides V3.0). Strings live in donations.rides.ts.
  rides,
  knowledge: {
    hubBody: 'הציעו חונכות או שיעורים, הזמינו משבצת, השלימו ודרגו. ארגוני למידה מופיעים למטה.',
  },
  addLinkModal: {
    title: 'הוספת קישור חדש',
    editTitle: 'עריכת קישור',
    urlLabel: 'קישור (URL)',
    urlPlaceholder: 'https://...',
    nameLabel: 'שם תצוגה',
    namePlaceholder: 'שם העמותה / הקבוצה',
    descriptionLabel: 'תיאור (אופציונלי)',
    descriptionPlaceholder: 'מה אפשר למצוא בקישור הזה?',
    cancel: 'ביטול',
    submit: 'להוסיף',
    save: 'לשמור',
    submitting: 'מאמת קישור...',
    helperText: 'הקישור יבדק שיהיה תקין לפני ההוספה.',
    editHelperText: 'השינויים יבדקו מול השרת לפני השמירה.',
    errors: {
      invalid_url: 'הקישור לא תקין. ודאו שהוא מתחיל ב-http או https.',
      invalid_input: 'נא לוודא שכל השדות מולאו כראוי.',
      unreachable: 'הקישור לא נפתח. ייתכן שהוא לא פעיל.',
      rate_limited: 'הוספתם הרבה קישורים בזמן קצר. נסו שוב בעוד שעה.',
      unauthorized: 'יש להתחבר כדי להוסיף קישור.',
      forbidden: 'אין הרשאה לערוך את הקישור הזה.',
      network: 'בעיית רשת. נסו שוב.',
      unknown: 'שגיאה לא צפויה. נסו שוב.',
    },
  },
  marketplaceHubTitle: 'שוק התרומות',
  marketplaceHubSubtitle: 'כל עולמות הנתינה במקום אחד',
} as const;

export const search = {
  tabLabel: 'חיפוש',
  title: 'חיפוש',
  placeholder: 'לחפש אנשים, פוסטים, קישורים...',

  // Category chips
  all: 'הכל',
  posts: 'פוסטים',
  people: 'אנשים',
  links: 'קישורים',
  orgs: 'ארגונים',
  hashtags: 'האשטגים',

  // Sort options
  sortBy: 'מיין לפי',
  sortRelevance: 'רלוונטיות',
  sortNewest: 'חדש ביותר',
  sortFollowers: 'עוקבים',

  // Filter
  filters: 'סינון',
  filterCity: 'עיר',
  filterPostType: 'סוג פוסט',
  filterCategory: 'קטגוריה',
  filterDonationCategory: 'קטגוריית תרומה',
  filterMinFollowers: 'מינימום עוקבים',
  filterRadius: 'רדיוס מהעיר',
  radiusKm: 'עד {km} ק"מ',
  clearFilters: 'לנקות סינון',
  applyFilters: 'החל סינון',

  // Results sections
  sectionPeople: 'אנשים',
  sectionPosts: 'פוסטים',
  sectionLinks: 'קישורים',
  sectionOrgs: 'ארגונים',
  sectionHashtags: 'האשטגים',
  suggested: 'חיפושים מומלצים',
  showAll: 'להציג הכל',

  // Result info
  followers: '{{count}} עוקבים',
  givenItems: '{{count}} פריטים נתנו',
  inCategory: 'בקטגוריית {{category}}',

  // States
  noResults: 'לא נמצאו תוצאות',
  noResultsDesc: 'נסו מילות חיפוש אחרות או שנו את הסינון.',
  recentSearches: 'חיפושים אחרונים',
  clearRecent: 'לנקות היסטוריה',
  startSearching: 'התחילו לחפש',
  startSearchingDesc: 'חפשו אנשים, פוסטים וקישורים בכל הקהילה.',
  minChars: 'הקלידו לפחות 2 תווים',
  loading: 'מחפש...',
  nationalLinks: 'מציג קישורים ארציים',
  give: 'נתינה',
  request: 'בקשה',
  giveBadge: '🎁 נתינה',
  requestBadge: '🔍 בקשה',

  // Post categories for filter
  categories: {
    Furniture: 'רהיטים',
    Clothing: 'בגדים',
    Books: 'ספרים',
    Toys: 'משחקים',
    BabyGear: 'ציוד תינוקות',
    Kitchen: 'מטבח',
    Sports: 'ספורט',
    Electronics: 'חשמל',
    Tools: 'כלי עבודה',
    Other: 'אחר',
  },


  // Donation categories for filter
  donationCategories: {
    time: 'זמן',
    money: 'כסף',
    food: 'אוכל',
    housing: 'דיור',
    transport: 'תחבורה',
    knowledge: 'ידע',
    animals: 'חיות',
    medical: 'רפואה',
  },
} as const;

export const marketplace = {
  ...marketplaceMap,
  browseTitle: 'שוק',
  searchPlaceholder: 'חיפוש מודעות…',
  allWorlds: 'כל העולמות',
  openMap: 'תצוגת מפה',
  createListing: 'פרסום מודעה',
  loading: 'טוען…',
  empty: 'אין מודעות לפי הסינון.',
  clusterLabel: '{{count}} מודעות',
  notFound: 'המודעה לא נמצאה.',
  startChat: 'שליחת הודעה',
  shareFeed: 'שיתוף בפיד',
  actionFailed: 'הפעולה לא הושלמה. נסו שוב.',
  chatOpener: 'היי — ראיתי את המודעה שלך בשוק.',
  createTitle: 'מודעה חדשה — {{world}}',
  fieldTitle: 'כותרת',
  fieldSummary: 'תקציר',
  publish: 'פרסום',
  publishing: 'מפרסם…',
  forYouTitle: 'בשבילך',
  createHubTitle: 'בחירת עולם נתינה',
  fieldKind: 'סוג מודעה',
  fieldWorldSubcategory: 'תת-קטגוריה',
  fieldWorldSubcategoryHint: 'לא חובה — עוזר למצוא לך התאמות',
  fieldDirection: 'מציע / מבקש',
  fieldCity: 'עיר / אזור',
  fieldRadius: 'רדיוס חיפוש: {{km}} ק״מ',
  fieldPhotos: 'תמונות',
  fieldPhotosHint: 'מודעות עם תמונה מקבלות יותר תגובות.',
  validationFailed: 'בדקו את הטופס ({{code}}).',
  errors: marketplaceErrors,
  shareLink: 'שיתוף קישור',
  report: 'דיווח על מודעה',
  reportTitle: 'דיווח על מודעה זו',
  similarTitle: 'מודעות דומות',
  anonymousOwner: 'חבר/ת קהילה',
  profileListingsTitle: 'מודעות בשוק',
  profileListingsEmpty: 'אין מודעות ציבוריות עדיין.',
  statusClosed: 'הושלם',
  myListingsNav: 'המודעות שלי',
  myListingsTitle: 'המודעות שלי',
  myListingsSubtitle: 'עריכה, השהיה, סימון כהושלם או מחיקה. השלמה מעניקה קארמה.',
  myListingsEmpty: 'אין לך מודעות עדיין.',
  myListingsEdit: 'עריכה',
  myListingsPause: 'השהיה',
  myListingsResume: 'חידוש',
  myListingsFulfill: 'סימון כהושלם',
  myListingsFulfillTitle: 'לסמן כהושלם?',
  myListingsFulfillHint: 'המודעה תיסגר ותקבלו נקודות קארמה על השלמת נתינה/בקשה.',
  myListingsDelete: 'מחיקה',
  myListingsDeleteTitle: 'למחוק את המודעה?',
  myListingsDeleteHint: 'המודעה תימחק לצמיתות.',
  myListingsSave: 'שמירת שינויים',
  myListingsUpdated: 'עודכן {{date}}',
  myListingsHiddenHint: 'מוסתרת מאחרים עד שהצוות יבדוק את הדיווחים',
  world: marketplaceWorldLabels,
  orgPicker: marketplaceOrgPicker,
  browseRefine: marketplaceBrowseRefine,
  field: marketplaceFieldLabels,
  option: marketplaceOptionLabels,
  availability: marketplaceAvailabilityLabels,
  listingStatus: marketplaceListingStatusLabels,
} as const;
