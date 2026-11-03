# 10 — Challenges layer (D43, D46, D52)

Challenges are a **world in the one world list** (D100: give = open a challenge, take = join; community and personal, every anonymity level — [05 §5.12](./05_giving_worlds.md#512-challenges-challenges--phase-2)) **and** a cross-cutting engine that every other world uses (D43, D46). Personal (read 10 pages a day), group (weekly run) and community ("1,000 meals this month").

- **One engine** (D46). A giving challenge opens from two places — inside any giving world (e.g. "gave away 5 items this month" from items) and from the challenges screen. Same challenge, same counting, same karma.
- Giving challenge: linked to a world, counted from closings. Personal challenge: counted from self-report.
- **Every interaction earns karma** (D52): opening, and each daily/weekly/monthly report per cadence — including non-giving personal challenges like running. Community > private; large community > small. Values in [07 §7.6](./07_cross_cutting_systems.md#76-karma).
- Streaks, goals, group leaderboard **without exposing personal karma**, group chat locked at the end (S29).
- Shown in the "Challenges" block of every world hub and in the profile. An event may start a group challenge.

Model: `Challenge`, `ChallengeScope: personal | group | community`, `ChallengeParticipation`.
Tech: · D18 (challenges as a world) superseded · none · G26
