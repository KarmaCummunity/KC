# Playbook — Distribute Public Research (Survey B)

> **Owner:** PM. **Cadence:** per distribution wave (typically once per ~2 weeks while iterating on the product).
> **Outcome:** populated rows in `public.public_research_responses` keyed by `?src=` attribution, eventually synthesized into the Karma Phrasebook (see `docs/SSOT/archive/superpowers/specs/2026-05-25-surveys-and-feedback-design.md` §2).

## When to run a wave

- Before a major roadmap decision that depends on competitor pain signals
- When recruiting for a new alpha cohort
- After a Karma feature ship to test if positioning resonated (with a new `?src=` for that wave)

## Channels and `?src=` attribution

Each post in a channel uses a distinct `?src=` value. Soft cap: 100 responses per source per wave (monitor in admin portal; do NOT enforce in the RPC — the cap is editorial discipline so one viral group doesn't dominate the dataset).

| Channel | `?src=` value | Notes |
|---|---|---|
| Facebook giving group (e.g., "תרומה ונתינה תל אביב") | `fb-giving-tlv` | One post per group, no cross-posting |
| Facebook neighborhood group (generic) | `fb-neighborhood-<city>` | e.g., `fb-neighborhood-givatayim` |
| Facebook Marketplace (giveaway listings) | `fb-marketplace` | Comment-bombing not allowed |
| WhatsApp neighborhood group | `wa-group-<area>` | e.g., `wa-group-florentin` |
| Agora (free items category) | `agora-free` | Post in the relevant subcategory |
| Yad2 (free items category) | `yad2-free` | If applicable |
| Parents' group (Facebook / WhatsApp) | `parents-<area>` | Strong alt-platform overlap |
| Secondhand-buying group | `secondhand-<area>` | Captures the "minimalism / decluttering" segment per design spec §11 |
| Paid Meta ad (interest: minimalism) | `meta-ad-minimalism` | For cohort #2 — lapsed competitor users per design spec §11.3 |
| Direct distribution / pasted in chats | `direct` | Default if no src param |

## Per-wave playbook

1. **Plan the wave** (1 day before)
   - Decide which channels to hit and assign one `?src=` per channel
   - Draft the CTA copy. Default: `בונים אפליקציית נתינה ישראלית. 11 שאלות, אנונימי, משנה הכל.`
   - URL template: `https://karma.community/research/alt-platforms-research?src=<value>`
2. **Post** (Day 0)
   - One post per channel, link with `?src=<value>`. Pin the post if the channel allows.
3. **Monitor** (Days 1–14)
   - Check the admin portal daily for response count per `source`. Cap at 100 per source per wave.
   - Watch for rate-limit hits / circuit-breaker trips in Supabase logs — investigate if abnormal.
4. **Close the wave** (Day 14)
   - Set `surveys.is_active = false` for `alt-platforms-research` (or leave open if responses still trickling)
   - If publishing a new version with different questions: super-admin runs `publish_survey_version` RPC in Studio. Old responses are preserved.
5. **Synthesize → Karma Phrasebook** (Days 15–17)
   - Export all free-text answers via the admin portal CSV
   - For each frequent pain phrase, find a matching relief phrase from Survey A free-text. Populate the 3-column Google Sheet per design spec §2.
   - Distribute the phrasebook update to marketing/copy contributors.

## Failure modes

- **Survey B not seeded after a fresh DB reset:** seed runs as part of migration `0131` but requires a super-admin user. If no super-admin exists, the seed prints a NOTICE and skips. Operator must call `publish_survey_version('alt-platforms-research', ...)` manually.
- **Edge Function rejects all requests with 403:** check `PUBLIC_RESEARCH_ALLOWED_ORIGINS` env var. Add the production domain.
- **Rate-limit hits dominate logs:** check the daily salt is rotating. If it isn't, all responses from the same IP share a hash forever — fix the `rotate-research-salt` schedule.
- **No responses coming in despite link posted:** verify the `?src=` value matches the regex `^[a-z0-9_-]{1,32}$`; otherwise the RPC's CHECK constraint rejects the insert.

## Karma Phrasebook (the actual deliverable)

The phrasebook is a Google Sheet (linked from `docs/spec/requirements/16_public_research.md` once created). It has three columns:

| Pain language (Survey B quote) | Relief language (Survey A quote) | Where it ships |
|---|---|---|

See `docs/SSOT/archive/superpowers/specs/2026-05-25-surveys-and-feedback-design.md` §2 for the philosophy. The PM owns updating this sheet after each wave.
