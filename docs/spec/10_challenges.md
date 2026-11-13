# 10 — Challenges layer (D43, D46, D52)

Challenges are a **world in the one world list** (D100: give = open a challenge, take = join; community and personal, every anonymity level — [05 §5.12](./05_giving_worlds.md#512-challenges-challenges--phase-2)) **and** a cross-cutting engine that every other world uses (D43, D46). Personal (read 10 pages a day), group (weekly run) and community ("1,000 meals this month").

- **One engine** (D46). A giving challenge opens from two places — inside any giving world (e.g. "gave away 5 items this month" from items) and from the challenges screen. Same challenge, same counting, same karma.
- Giving challenge: linked to a world, counted from closings. Personal challenge: counted from self-report.
- **Every interaction earns karma** (D52): opening, and each daily/weekly/monthly report per cadence — including non-giving personal challenges like running. Community > private; large community > small. Values in [07 §7.6](./07_cross_cutting_systems.md#76-karma).
- Streaks, goals, group leaderboard **without exposing personal karma**, group chat locked at the end (S29).
- Shown in the "Challenges" block of every world hub and in the profile. An event may start a group challenge.

Model: `Challenge`, `ChallengeScope: personal | group | community`, `ChallengeParticipation`.


## Behaviour (ported from the legacy MVP-MONOREPO challenges, improved)
- **Scope:** `personal` (visible and joinable by the creator only) or `community` (public, anyone may join). The invite-only `group` scope is specified but not built.
- **Measurement:** `yes_no`, `count` or `duration_minutes`. **Cadence:** `daily`, `weekly` (Sunday-to-Saturday Israel week) or `flexible`.
- **Goal:** optional numeric goal value with a direction, `at_least` or `at_most` (never on `yes_no`). Also optional: difficulty, a free-text topic label, a deadline, and a target number of successful cycles.
- **Reports:** one report per participant per cycle; filing again in the same cycle overwrites it. A report may be dated today or up to 2 days back, never ahead (Israel date, decided by the server).
- **Streak:** consecutive successful cycles (goal met). It breaks when a full cycle is skipped, so the streak shown is always the live one. `flexible` challenges keep no streak, only the count of successful cycles.
- **Completion:** reached when the participant's successful cycles hit the target number of cycles.
- **Leaderboard:** participants only; ranks streak and successful cycles and never exposes karma.
- **Karma** (values in [07 §7.6](./07_cross_cutting_systems.md#76-karma)): opening 2 private / 3 community, at most 2 a day; report 1 / 2 / 3 once per cycle; completion 10 / 15 / 20; "large" means 50+ participants. Only the database awards karma; the client never computes it.
- **Identity:** every action runs as `auth.uid()`. The legacy engine trusted a client-sent user id; that hole is closed.
- **Opening:** "give" is the `challenges` category of the one create form (FR-POST-001 AC6); there is no separate create screen. Until the launch flag is on, that category still takes links. Opening writes a post of `post_type = challenge` in the challenges world (`0639`); the world screen is that world's feed (FR-FEED-020). A community challenge is a public post and a personal one is OnlyMe. Ending the challenge pauses the post.
- **Detail screen "Join":** a viewer who hasn't joined an active challenge sees a compact "Join" pill. When the comment composer is docked, the pill sits just above it and never covers it, including while the keyboard is open; without a composer (signed out, no linked post) it floats above the tab bar (KC#1947, same rule as FR-POST-015 AC6).
- **Launch:** the world is gated by the launch flag `world_challenges_enabled` (D60); it defaults to on (PM 2026-11-04) and is on in every environment (D165); while it is off the world is a portal (links only).

Tech: · D18 (challenges as a world) superseded · migrations `0594`, `0639` (challenge posts) and `0640` (city id, not the slug `tel-aviv`), tests `supabase/tests/0594_challenges.sql` and `0639_challenge_posts.sql`, screens under `app/(tabs)/donations/challenges` · G26 (remaining: giving challenge counted from closings, group scope and group chat lock (S29), challenge notifications, karma reversal on leave/removal, moderation of challenges, challenge images)
