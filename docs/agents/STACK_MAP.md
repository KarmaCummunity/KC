# Stacked PR map

Merge order for open stacked PRs into `dev`. **Merge a base before its children.** After a base merges, retarget the child to `dev` (`gh pr edit <n> --base dev`) and rebase it if needed.

_Updated by the coordinator. Last update: 2026-10-17._

## Stack A: social / perf

```
#885 engagement + realtime
  -> #887 notifications + chat v2
     -> #892 social3 (for-you feed, search, follow suggestions)
        -> #910 feed indexes / materialized feed (DB perf)
```

#911 mobile perf (cache, lists, CDN images) currently targets `dev` directly; merge it after #892 so it rebases on the social changes.

## Stack B: schema / marketplace

```
#860 unified schema
  -> #886 matching
     -> #889 PRD roles + payments
        -> #902 WhatsApp bot
           -> #912 unified giving marketplace
              -> #913 money world (donations, standing orders)
```

## Independent

- #851: mobile EAS / TestFlight fixes (base `dev`)
- #890: TestFlight + Play internal workflows (base `dev`, needs #851)

## Rules

- Keep stacks shallow. Start new work from `origin/dev`, not from a stack tip, unless you really depend on it.
- Each PR stays self-contained: its own migrations (see [MIGRATION_RANGES.md](./MIGRATION_RANGES.md)), and tests.
