---
name: Contributor task
about: A well-scoped KC task for external contributors
title: "[contrib] "
labels: ["contributor-facing", "good first issue"]
---

## Goal

<!-- One sentence: what should be true when this is done? -->

## Why it matters

<!-- Short product/UX context for someone new to the repo. -->

## Acceptance criteria

- [ ]
- [ ]
- [ ]

## Files likely to touch

- `app/apps/mobile/...`

## Out of scope

- Store release configuration (`eas.json`, signing) and production deploy workflows
- Hosted Supabase credentials / env secrets
-

## How to verify locally

1. `./scripts/dev-up.sh` (if DB needed)
2. `cd app && pnpm install`
3. Copy `app/.env.example` → `app/.env.local`, then `pnpm mobile` (or `pnpm --filter @kc/mobile web`)
4. `cd app && pnpm typecheck && pnpm test && pnpm lint`
5. Manual checks:

## Estimated size

- [ ] `size:S` (under ~half a day)
- [ ] `size:M` (~one day)

## Labels to apply

`contributor-facing` + `good first issue` or `help wanted` + `area:*` + `size:*`
