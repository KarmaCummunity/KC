# Core loop analytics events (#1055)

Product analytics uses PostHog when `EXPO_PUBLIC_POSTHOG_KEY` is set. The mobile facade lives in `app/apps/mobile/src/lib/analytics.ts`; core-loop helpers add required dimensions in `analyticsCoreLoop.ts`.

## Event catalog

| Event | When | Required properties |
| --- | --- | --- |
| `signup` | Account created | `city` (`lod` \| `other`), optional `method` |
| `activation` | First listing **or post** published (once per install) | `city`, `world`, `seconds_since_signup` (when the account creation time is known, #1042) |
| `listing_created` | Marketplace listing **or post** saved (both engines of the unified create form) | `city`, `world` |
| `match_shown` | Matches list rendered with ≥1 open suggestion | `city`, optional `count` |
| `match_feedback` | User accepts or declines a match (#1121) | `city`, `world`, `response` (`accept` \| `decline`) |
| `chat_started` | Chat opened from a listing | `city`, `world` |
| `handover_completed` | Giver/receiver marks handoff complete | `city`, `world` |
| `return_visit` | Authenticated user reopens the app after first open | `city` |

## City dimension

`city` is derived from the viewer or listing `city_id`: `7000` (Lod) → `lod`, anything else (including unknown) → `other`. See `LOD_CITY_ID` in `@kc/domain` (`launch/launchWorlds.ts`).

## World dimension

`world` is the marketplace world slug (`items`, `food`, …) when the event is world-scoped. Posts from the unified create form's post engine report `world = general`.

## Time to first post (#1042)

`activation.seconds_since_signup` = whole seconds from the auth account's `created_at` to the first publish on this install. Read the **median** of it in PostHog (the issue's target is under 30 seconds of active use; the raw value includes time spent before installing). It is omitted when the creation time is unknown or ahead of the device clock.

## Legacy events

`match_made` and `donation` remain for older dashboards; new work should prefer `match_feedback` / `handover_completed` and the table above.
