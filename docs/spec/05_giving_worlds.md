# 05 — Giving worlds and user journeys

Shared skeleton (post, closing, karma) is in [07](./07_cross_cutting_systems.md).

## 5.1 Food (`food`) — MVP, live
More than a third of food in Israel is thrown away while families lack it. Connects surplus to need within hours. Leket is the natural partner for volume (D37); KC handles neighbor-to-neighbor.
1. Photograph & post — offer requires photo, expiry date, allergens (D28, D21).
2. Matching — notify only on good match or saved filter (D10).
3. Chat & pickup — one chat per pair, post pinned (D13).
4. "Mark delivered" — karma, internal rating (D12, D15, D24). Unclaimed offers auto-close at expiry, alert 24h before (S4). Tech: hourly `food_expired_listings_sweep` → status `expired`, `notifications_food_expiry_check` (`0467`, KC#1316); "close at midnight of the expiry date" (S4) not applied — the giver's own expiry time is used.
Hub: food-safety knowledge; food banks; distribution points & community fridges; plug-in "event leftovers" routing (S36). Requests have no expiry (D21). Emergency food-shortage template (D42).

## 5.2 Items (`items`) — MVP, live
Huge market already exists in WhatsApp/Facebook/Yad2 "giveaway" without trust or tracking; KC brings it home (D38).
1. Post — item subcategory, condition, recommended photo (S19), address at chosen display level.
2. Requests via chat/comments (D25); poster chooses.
3. Handoff — "mark delivered" + recipient (D17, D19). Large items → rides for transport.
4. No expiry; relevance reminder after 14 days (D21, S3).
Item subcategories (D18): furniture, kitchen, clothing, books, toys, baby, sport, electronics, tools, other. Baby-product safety warning.

## 5.3 Transport (`transport`) — rides sub-category, MVP (flag on since `0511`)
The transport world replaces the rides world (D100); rides are its first and, for now, only sub-category. The code slug stays `rides` until the registry task (`G50`), and nothing in the launch rides flow below changes for users.

Rides live in WhatsApp groups; dedicated apps failed on critical mass. This world is the main growth engine: WhatsApp group import (D38, D47) and fixed routes. The bar is the WhatsApp ride group: publishing a ride is as fast as sending a message, and everyone who cares about that route hears about it at once (D70–D75).

One rides flow (D70): ride offers and requests are posts with a ride extension; bookings use the generic handoff stage. The separate legacy ride screens are retired; their emergency button and cost-sharing caps attach to this flow.

1. Driver posts (quick publish, D75) — origin, destination, up to 3 meeting points, departure, estimated end, seats. The last route is remembered and a past ride can be published again. Anyone may drive; verification is shown (D23). A **recurring ride** (D103) is the same post with weekdays, a departure time and an optional end date: the server publishes one ordinary ride per upcoming day (30 days ahead), cards say "every Sun–Thu at 07:30", an occurrence lists the series' other dates to book, and the member pauses, reschedules or cancels the series from "my recurring rides"; a ride someone already booked stays an agreed ride.
2. Places — origin, destination and meeting points are picked **only** from official catalogs: cities, streets, and named junctions & interchanges. No free-text places (D71).
3. Passenger books a seat or posts a ride request. The driver sees every booking on the ride and approves or declines each; both sides get a push on every change (D73). Chat per pair (D13). An unapproved booking expires 12 hours after it was made or at departure, whichever is earlier, and frees its seats (D96).
4. Saved route (D74) — a user follows a route (from → to, optional days and hours) and is notified of new rides along it; the rides form of the saved filter (D10). Urgent rides notifications bypass quiet hours (D95).
5. Map (D72) — the ride's route (origin → meeting points → destination) is shown on the map; every place has "navigate" to Waze, Google Maps or Apple Maps.
6. Ride — emergency button during an active ride.
7. "Ride completed" — the driver can finish the ride once from the offer; confirmed bookings complete together, earn the existing driver/passenger karma values, the offer closes immediately, and each passenger may optionally rate the driver. Pending unapproved bookings are cancelled. If the driver does not finish it, an uncompleted offer still expires 30 minutes after estimated end (or departure when no end was set) (D21). The app emits the existing `handover_completed` core-loop event (`0530`).

Feed (D75): offers and requests together, sorted by departure, grouped today / tomorrow / later; departed rides are hidden.
Rules: no profit — cost-sharing caps (₪70 intercity / ₪20 urban). Secondary use: moving items/food.
Gaps: G44–G46, G48, G49 (G47 ✅), G52 ✅.

Tech (G52 ✅, FR-RIDE-046): `ride_series` (owner-only RLS; `0531`) holds the schedule and the details template; `ride_series_materialize` publishes one listing per matching day for the next 30 days with `details.ride_series = {id, on, weekdays, time}` (one per series and day), so feed, search, matching, bookings, alerts and the emergency call need no change; `ride_series_sweep` (every 10 min) materializes, expires departed request occurrences and mirrors only the soonest upcoming occurrence into the main feed (`listings_feed_mirror_sync` skips the others); the rides feed (`list_rides_feed`) lists today's and tomorrow's occurrences one by one and folds a series' later dates into one row with their count; `list_ride_series_occurrences` lists a series' upcoming dates for "other dates" on an occurrence; a saved-route follower is alerted once per series. RPCs `create_ride_series`, `update_ride_series`, `set_ride_series_status` (pause / resume / cancel: upcoming unbooked occurrences are removed, booked ones stay; cancel is terminal and detaches booked rides). App: the "recurring ride" switch in the create form (`RideRecurrenceFields`), the recurrence chip on cards and the ride detail, "other dates" chips on an occurrence (`RideSeriesOccurrences`), `/donations/rides/series` (`MyRideSeriesList`). The legacy `ride_templates` → `ride_listings` materializer (0148, FR-RIDE-021/022) is superseded.

Tech (G47 ✅): driver bookings list + approve / decline / expiry sweep / one `important` push per booking change (`0511`; `list_ride_bookings`, `decline_ride_booking`, `ride_bookings_expire_sweep` every 10 min, `giving_handoffs.cancel_reason`); app: `RideBookingActions` (driver `RideBookingsPanel`, passenger `RidePassengerBooking` with seat count) over `IRideBookingRepository`.

Tech (G45 ✅): `road_junctions` catalog (449 existing Ministry of Transport junctions & interchanges, `0513`, generated by `scripts/import-road-junctions.mjs`, converted from the Israeli grid by PostGIS); `list_ride_places` feeds one picker (city + optional official street, or junction); `listings_ride_places_canonical` refuses a place that is not in a catalog (`ride_place_invalid`) and rewrites every place's name and coordinates from it; ≤ 3 meeting points in `details.meeting_points` (`0512`). Source credited in About.

Tech (G46 ✅): the ride detail lists origin → meeting points → destination with "navigate" per place (`rideNavigationUrl`: Waze / Google Maps everywhere, Apple Maps on iOS; cities and junctions by coordinates, a street by address) and draws the route through the meeting points on the map (`RideRouteMap` over `KcMap.routeStops`).

Tech (G49 ✅) — quick publish: `RideCreateSection` = place route + `RideScheduleFields` (departure shortcuts in 30 min / in 1 hour / tomorrow 07:00, `arrives_at` suggested by `suggestRideArrival` until edited, seats 3 within 1–8); the form starts from "publish again" or the device's last route (`rideStartDetails`); `listings_ride_schedule` sets an offer's expiry to estimated end + 30 min and `rides_expired_listings_sweep` expires it (`0514`). Owner completion closes it earlier via `complete_ride_listing` (`0530`). `DateTimeField` is cross-platform (Android date → time dialogs, web `datetime-local`) and replaces the raw picker in every world's form. Feed: `list_rides_feed` (`0515`) returns open offers and requests not yet departed, soonest first, with free seats / passengers; the hub groups them today / tomorrow / later (`RidesFeedList`, refreshed every minute).

Tech (G48 ✅): `ride_saved_routes` (RLS own rows, places canonical, ≤ 10) and `ride_route_alerts`; a new published ride alerts each follower once when its origin or a pickup point and its destination are within the route radius, on a followed day and hour (Israel time); delivery caps 10 a day and holds alerts during quiet hours unless the ride departs before they end — the 10-minute sweep sends held ones (`0516`, kind `ride_route_match`). App: "notify me about rides on this route" and "my routes" in the hub search.

Tech (G44 ✅): `listings_ride_route_cost_cap` caps the cost share at ₪20 when both ends are in one city and ₪70 otherwise, after the places are made canonical; `ride_listing_emergency` lets the driver or an approved passenger call for help from 1 hour before departure to 2 hours after the estimated end (once per 5 minutes) and alerts every other participant and the super admins (`0517`, kind `ride_listing_emergency`). The legacy `ride_listings` screens are retired: `/donations/rides/[id]` (+ `active`, `rate`) opens the ride's listing via `listings.legacy_ride_id`, or the rides hub; `my-rides` / `my-requests` open my listings.

## 5.4 Time & volunteering (`time`) — MVP, live
Anyone can give an hour (D22). One-off, person-to-person, and org events.
1. Offer or request with estimated duration (D32).
2. Match & chat.
3. "Volunteering done" — unaffiliated: karma by declared duration (S14); affiliated: hours approved by the org manager (D32).
Emotional support only via a hotline.
Sub-categories (D100): elderly & loneliness (D39, S24; home visit requires volunteer ID verification, D48), sport, cleanups, class seats, general. Organizations that are not lawful employers recruit volunteers here, not in employment.

## 5.5 Money (`money`) — MVP (Grow) → phase 2
No money between users (D4). Now: donate to KC, one-time or recurring, via a Grow hosted payment page (D20) — the app only redirects and receives confirmation, so the provider can be swapped without code. Bit / PayBox transfer links are interim only and disappear once the one-time clearing page is live (D64). Vision: a JGive-like platform inside the app for every approved org, section-46 receipts, with JGive as partner (D37). No post form. Org directory with proper-management badge (S35).

## 5.6 Housing (`housing`) — next to launch (D30)
Two tracks: (a) community hosting à la Couchsurfing; (b) housing for at-risk populations (street people, at-risk youth, foster care, people fleeing violence) — only via professional bodies. **ID verification required for both sides** (D30).
1. Verified host posts — room/couch, dates, nights, house rules; city only.
2. Verified guest requests — both see verification level, completed stays, seniority — not ratings (S16, D24).
3. Chat before approval — exact address revealed only after approval.
4. "Hosting done" — karma, internal rating. At-risk track: confidential request via org, not in the public feed.
Always free. Minors only with a parent; at-risk youth only via an org (S16). Emergency: evacuee hosting (D42).

## 5.7 Knowledge, rights & legal aid (`knowledge`) — phase 2
Content exists (Kol Zchut, Campus IL); the missing piece is personal connection. Lessons and mentoring for free, plus rights and legal aid (D40): a pro-bono "consulting hour" post by lawyers, accountants, advisors (S36). No binding legal advice in posts — refer to an authorized party.
Sub-categories (D100): science & technology, history & heritage, culture & art, spirituality & philosophy, rights & legal aid, lessons & mentoring. A recurring lesson may also be marked for the time world (D101). Listing approval rule pending (KC#1037).

## 5.8 Medical (`medical`) — directory now, feed later
A world of its own (D100; was a domain under D45). **Only verified medical bodies publish** (D30, S17) — Yad Sarah, MDA, Ezer Mizion, ADI; regular users view, contact, borrow and return. The curated philanthropic medical directory (24 bodies, 10 topics, KC#1314) feeds the hub.
1. Equipment lending — offer by a medical body with return date; request by anyone.
2. Blood and organ donation — deep links to the official registries only; no personal health data stored.
3. Information and calls — blood calls only from medical bodies; a local shortage becomes a targeted emergency (D42).
Rules: no medical advice in any post; a "not medical advice" notice on every medical screen.

## 5.9 Animals (`animals`) — phase 2
Give and take for animals (D100): supplies, foster, adoption, care and training knowledge, feeding and water points (plug-in map). SPCA as lead partner. **Everyone may publish and take** (PM 2026-11-02); the only rule is the platform-wide one — everything is free, nothing is sold.

## 5.10 Democracy (`democracy`) — phase 3
Kept as a world, empty for now (D100). Content is the governance layer of [11](./11_governance.md): rules, rule parameters, proposals and votes (KC#1032), civic knowledge and advocacy nonprofits (D40). Strict party-political neutrality (S25).

## 5.11 Employment (`employment`) — phase 2
Give = post a job; take = apply (D100). **Only a verified organization that is regulated by law and may legally employ people posts jobs**; an organization that is not such recruits volunteers in the time world (PM 2026-11-02; refines D41, D53, D57). Free posting; philanthropic and nonprofit-sector roles only; no karma on paid jobs (S27). Applications open a chat anchored on the job; no CV storage in v1. Job board gap: G28.

## 5.12 Challenges (`challenges`) — phase 2
Give = open a challenge; take = join (D100). Community and personal challenges, with every anonymity level the app supports. The one challenge engine of [10](./10_challenges.md) (D46) stays: a giving challenge can still be opened from inside any world and is counted from closings. Supersedes "challenges are a layer, not a world" (D43) for the product structure only; the engine, karma rules and streaks in 10 are unchanged.

## 5.13 Experiences — removed (D100)
The experiences world (D45) was dropped: unused tickets are items (sub-category tickets, expiry at event date), free class places and workshops are time posts. Free only — a priced ticket breaches the terms.
