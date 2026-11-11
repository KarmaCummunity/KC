# 94 — Glossary and naming conventions

## Glossary
| Term (HE) | Term (EN) | Definition |
|---|---|---|
| מקור האמת | Source of truth | The Hebrew project-book page (D35); this folder is its English derivation |
| פוסט | Post | The only publishing entity (D2, D19) |
| סוג פוסט | Post type | World + direction, or event/job; drives form, expiry and closing |
| עולם נתינה | Giving world | Type of giving; one list of 12 (D100); a post has one primary world and optional additional worlds (D101) |
| תת-קטגוריה של עולם | World sub-category | Per-world list (item subcategory, food type, time: elderly & loneliness / sport, knowledge: science & technology / …); drives the form, browse filters and matching. The former "domain" tag (D45) is gone (D100) |
| מרכז עולם | World hub | World screen built from config (D36); no domain hubs (D100) |
| שכבה רוחבית | Cross-cutting layer | Applies to all worlds: challenges, emergency, karma |
| בלוק מתוסף | Plug-in block | World-specific component on the shared template (D36) |
| תת-קטגוריה של חפצים | Item subcategory | Kind of item (D18) |
| מסירה | Handoff | Closing stage of every post (D19) |
| תפוגה / תזכורת רלוונטיות | Expiry / relevance reminder | Auto-close per type; "still relevant?" (D21) |
| מנוע המלצות | Recommendation engine | "Recommended" sort (D27, S33) |
| נקודות קארמה | Karma points | Visible to owner and main admin (D29) |
| רמת אימות | Verification level | Phone / ID / blue check (D23) |
| רמת אימות ארגון | Org verification level | basic → effectiveness (D53) |
| דירוג / מנוע אמון | Rating / trust engine | Internal only (D15, D24) |
| אירוע | Event | Org post type with registration (D31) |
| מתנדב משויך | Affiliated volunteer | Gets org permissions, logs hours (D22, D32) |
| מצב חירום | Emergency mode | App mode by region & world, 4 levels (D42) |
| אתגר | Challenge | Personal, group or community (D43) |
| פוסט מיובא / תביעה | Imported post / claim | From WhatsApp; ownership confirmed by phone verification (D38, S21) |
| גשר קבוצה | Group bridge | Parallel community + summaries during migration (S23) |
| מקום רשמי | Official place | A city, street, or named junction/interchange from an official catalog; the only kind of place a ride may use (D71) |
| נקודת איסוף | Meeting point | An official place along a ride where passengers board; up to 3 per ride (D71) |
| מסלול שמור | Saved route | A followed from → to route that notifies on new rides along it (D74) |
| הזמנת מקום | Seat booking | A passenger's request for seats on a ride offer; approved or declined by the driver (D73) |
| חוקת ברזל | Iron constitution | Rules core not changeable by vote (D40) |
| listings | listings (code term) | Legacy table to become `posts` (D19); **not** a product term |
| סעיף 46א | Section 46(a) | Income Tax Ordinance approval that lets donors claim a tax credit; KC records an org's approval and receipts, never decides eligibility or issues receipts (D77) |
| גזבר ארגון / רו"ח ארגון | Org treasurer / org accountant | Org-scoped finance roles: treasurer writes the books, accountant reads and exports (D76) |
| תמונת שקיפות | Transparency snapshot | Frozen yearly financial summary an org publishes on its profile; never live books, never donor names (D81) |
| פרופיל ארגון | Organization profile | Public page of an organization at `/org/{slug}`; always public (D88, D90) |
| חשבון ארגוני | Organization account | The organization's own sign-in identity, bound 1:1 to the organization; members with roles act in its name from their own accounts (D88) |
| פועל בשם | Acting as | The active profile context of a session: the person or one of their organizations, chosen in the profile switcher (D88) |
| ארגון לא נתבע | Unclaimed organization | Catalog profile imported from open data with no account yet; claimable by the real organization (FR-ORG-017) |
| מארח / אורח | Host / guest | The side that lends a space / the side that uses it, in every housing sub-category (`D112`) |
| תת-קטגוריית דיור | Housing sub-category | Stays & hosting, emergency shelter, event & gathering space, storage space |
| הזמנה | Booking | One guest's reservation of a housing offer for a date range or time slot; a handoff with `world_slug='housing'` |
| פרטים חסויים | Private details | Exact address, entrance and access instructions; shown only to the confirmed guest in the booking window |
| מאגר אירוח מוגן | Shelter pool | Hosts who agreed to host people placed by a verified organization; never public |
| רכז/ת אירוח | Housing coordinator | Member of a verified organization with housing coordination who takes shelter requests and places people |
| שיבוץ | Placement | A booking created by a coordinator on behalf of a person in need, possibly off-platform |
| אימות זהות | Identity verification | Level 2 of D23: an ID document + a live selfie matched by a certified provider (`D117`); code `VerificationLevel`, `identity_verifications` |
| משאב ידע | Knowledge resource | A free library entry (course, article, link, book, video, document, podcast, tool, dataset) with provenance and review; a catalog entity, not a post (S63) |
| מדף | Shelf | The knowledge world sub-category of D100 (six values); the first of the three knowledge axes (S64) |
| נושא / גרף נושאים | Topic / topic graph | Curated subject tree with aliases (Hebrew, English, transliteration); every knowledge post and resource has one primary topic (S64) |
| קטע ידע | Knowledge chunk | A retrievable passage of a native resource, lesson or community answer, with heading path and embedding, cited by agents (FR-KNOW-009) |
| שעת ייעוץ | Consulting hour | Pro-bono professional session post (S36) by an ID-verified giver with a declared profession (S70) |
| תשובה מקובלת | Accepted answer | The comment the asker marked on a question post; indexed as a community answer (FR-KNOW-005) |
| רשומת סיום | Completion record | KC community record of finishing a course; not an accredited certificate (S69) |

## Naming rules
1. Always the precise name: "giving world", "item subcategory", "post type" — **never a bare "categories"**.
2. One concept = one Hebrew name = one code identifier; new concepts enter this glossary first.
3. No "market" / marketplace / listing as a product concept (D2, D14).
4. World-hub components `World*` are generic; uniqueness only via `WorldHubConfig` / `WorldHubBlock` (D36).
5. Cross-cutting layers get no world slug (`Challenge`, `EmergencyMode`).

## Proposed identifiers (no code change implied)
| Concept | Proposed identifier | In code today |
|---|---|---|
| Post | `Post` / `public.posts` (D19) | `posts` + `listings` |
| Giving world | `GivingWorld`, `WORLD_SLUGS`: items, food, transport (code `rides` until `G50`), time, money, housing, knowledge, medical, animals, democracy, employment, challenges | `world_slug`, `MARKETPLACE_WORLD_SLUGS`, `GIVING_WORLD_SLUGS` + `DOMAIN_SLUGS` |
| Additional worlds | `Post.additionalWorlds`, `listing_worlds` (D101) | `Post.domain_slug`, `DomainHubConfig`, `POST_DOMAIN_SLUGS` |
| Hub | `WorldHubScreen`, `WorldHubConfig`, `WorldHubBlock` | `WorldMarketplaceHub` |
| Orgs / knowledge / resource | `WorldOrgDirectory`, `WorldKnowledgeArticle`, `WorldResource` | `donation_links` |
| Knowledge axes | `KnowledgeShelf` (`public.categories` under `knowledge`), `KnowledgeTopic` / `knowledge_topics` + `knowledge_topic_aliases`, `KnowledgePostKind` / `listing_kinds`, `KnowledgeResourceKind` / `knowledge_resource_kinds` | `categories` subject rows (`tech`, `languages`, …) |
| Knowledge resource | `KnowledgeResource` / `knowledge_resources` (+ `_versions`, `_bodies`, `_topics`), `KnowledgeChunk` / `knowledge_chunks`, `knowledge_search`, `api_knowledge_*` | none |
| Courses | `KnowledgeCourse` (`knowledge_course_modules`, `knowledge_course_lessons`, `knowledge_quizzes`, `knowledge_quiz_questions`), `KnowledgeEnrollment`, `KnowledgeCompletion` | `listing_kinds.course` (retired) |
| Knowledge exchange | `KnowledgeSlot` / `knowledge_slots`, `book_knowledge_slot`, `complete_knowledge_session`, `accept_knowledge_answer` | `0396` RPCs on one slot per listing |
| Post type / direction | `PostType`; `PostDirection: offer \| request` | `listing_kinds`; give/request |
| Form per type | `PostTypeFormSchema` | `createCategories.ts` |
| Subcategories | `ItemSubcategory` / `WorldSubcategory` | `Category` / `public.categories` |
| Extensions | `PostHandoff`, `RidePostDetails`, `EventPostDetails`, `HousingPostDetails` (+ `HousingBookingDetails`, `HousingPrivateDetails`), `NonprofitJobPostDetails` | `giving_handoffs`, `ride_listings` |
| Rating / match | `PostRating`, `PostMatch` | `ride_ratings`, `match_candidates` |
| Expiry | `Post.expires_at`, `PostRelevanceReminder` | none |
| Feed | `FeedRecommendationEngine`, `FeedSortMode`, `FeedAudience` | `PostFilterSheet` |
| Notifications | `NotificationType`, `NotificationPreference`, `NotificationGroup: important \| social \| emergency` | `inbox.tsx` |
| Karma | `KARMA_POINT_VALUES` | hard-coded in migration 0099 |
| Volunteering | `VolunteerHoursEntry`, `OrgVolunteerMembership` | none |
| Moderation | `PostReport`, `UserReport`, `UserSuspension` | `reports` |
| Trust | `VerificationLevel`, `TrustEngine`, `OrgVerificationLevel` | phone |
| Engagement | `PostLike`, `PostComment`, `PostCommentLike` | migration 0250 |
| Emergency | `EmergencyDeclaration`, `EmergencyLevel` | none |
| Challenges | `Challenge`, `ChallengeScope`, `ChallengeParticipation` | none |
| WhatsApp import | `ExternalGroupImport`, `ImportedPostCandidate`, `GroupBridge` | none |
| Partners | `PartnerOrg`, `PartnershipTier` | `donation_links` |
| Governance | `CommunityPoll`, `GovernanceProposal`, `ConstitutionClause` | none |
| Heritage | `HeritageTimelineEntry` | none |
| Donation to KC | `KcDonation`, `KcRecurringDonation`, `DonationPaymentProvider` | Bit/Paybox |
