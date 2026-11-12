# AGENTS.md — Karma Community agent rules

> **Single source of truth for all agent rules in this repo** (Cursor, Codex, Antigravity, Claude Code and the KC bot all read this file; `CLAUDE.md` only imports it). If anything below conflicts with another file, this one wins.

KC (Karma Community) is built largely by AI agents. **Part A** is the quick entry point (what to read, scope, definition of done); **Part B** is the full rulebook.

# Part A — Entry point

| Read | For |
|---|---|
| [`.claude/skills/kc-issue-to-merge/SKILL.md`](.claude/skills/kc-issue-to-merge/SKILL.md) | **Working an issue end to end**: pick, de-duplicate, claim, define, test-first, findings, PR, merge. Follow it for every task |
| [`docs/agents/OPERATING_MODEL.md`](docs/agents/OPERATING_MODEL.md) | Roles, the issue → PR → dev → kc-dev flow, labels, auto-merge |
| [`docs/agents/ISSUE_CLAIMS.md`](docs/agents/ISSUE_CLAIMS.md) | **Claim an issue before starting it**: skip `in-progress` issues |
| [`docs/agents/MIGRATION_RANGES.md`](docs/agents/MIGRATION_RANGES.md) | **Claim a migration number range before writing SQL** |
| [`docs/agents/STACK_MAP.md`](docs/agents/STACK_MAP.md) | Open stacked PRs and merge order |
| [`docs/agents/ARCHITECTURE.md`](docs/agents/ARCHITECTURE.md) | Apps / packages / supabase / workflows map |
| [`docs/architecture/current.md`](docs/architecture/current.md) | **Current architecture**: C4 diagrams, package boundaries, services, crons |
| [`docs/agents/DEPLOY.md`](docs/agents/DEPLOY.md) | **Deploy runbooks**: DB, web, seeding, types drift, E2E, all workflows |
| [`docs/agents/RELEASE.md`](docs/agents/RELEASE.md) | Versioning, TestFlight / Play internal, rollback |
| [`docs/architecture/adr/`](docs/architecture/adr) | **ADRs**: client state (ADR-001), data layer + new-RPC checklist (ADR-002), realtime (ADR-003) |

## Product focus

- **Mobile / web export:** `app/apps/mobile/**` (Expo, Hebrew RTL)
- **Backend:** `supabase/**` + `app/packages/infrastructure-supabase/**`
- KC is the only product in this repo (D-190). Do not add a second product tree or namespaced schema for one.

## Branch naming

`<type>/<issue#>-<area>-<slug>`: `type` ∈ `feat|fix|refactor|chore|docs|test|ci`, `area` ∈ `db|mobile|marketplace|bot|social|infra|docs`. Example: `feat/905-marketplace-map`. Always branch from `origin/dev`.

## Scope rules

- One issue per PR. Stay inside the issue's "files likely touched" and "out of scope" lists.
- Don't edit another role's paths without saying so in the PR (see Roles).
- Small PRs (≤ ~600 changed lines unless generated). Files ≤ 300 lines (`pnpm lint:arch`).
- PR base is always `dev`. **Never** `main`, kc-prod, or prod deploy workflows without Nave's explicit approval.
- No secrets in code, logs, issues or PRs.

## Definition of done

- [ ] Gates green locally (from `app/`): `pnpm typecheck && pnpm test && pnpm lint`
- [ ] New or changed behavior has tests
- [ ] Migrations, if any: numbered inside your claimed range, apply cleanly on a fresh stack (`./scripts/dev-up.sh`), RLS plus policy tests, no destructive ops (migration safety scan in the `static` lane of `CI gate`)
- [ ] DB types regenerated and committed if the API surface changed
- [ ] PR labeled with exactly one opened-by label (`agent:claude|cursor|kc-bot|antigravity|codex|other` or `human`), matching the `Opened by:` line ([ISSUE_CLAIMS.md](docs/agents/ISSUE_CLAIMS.md))
- [ ] PR body: `Closes #N` and `Mapped to spec: …`, following the AGENTS.md §6 template
- [ ] `CI gate` green, then label `agent-ready` to auto-merge
- [ ] After merge: verified on kc-dev / dev.karma-community.pages.dev

Store builds (TestFlight / Play internal): see [`app/apps/mobile/README.md`](app/apps/mobile/README.md).

## Migrations rule

Every schema change must be a committed file in `supabase/migrations/NNNN_snake.sql` (after the D-228 cut-over `0001_baseline.sql` is frozen history; the next file is `0002_…`; the retired chain is in `supabase/migrations/archive/`), applied only via `supabase db push` / the **Deploy** workflow. **Never** use the Supabase MCP `apply_migration` tool on any KC project (dev or prod). The `CI — migration drift` workflow scans the dev ledger against the **dev** branch's files (pinned with `ref: dev`, since scheduled runs execute from `main`). See `AGENTS.md` §9 and `docs/SSOT/OPERATOR_RUNBOOK.md` → "Migration application rules".

---

# Part B — Full rulebook

## ⚠️ APP VERSION (`app/VERSION`) — ALWAYS REMEMBER

**App-wide semver lives in `app/VERSION` (`MAJOR.MINOR.PATCH`).**

1. **PATCH is bumped automatically on every merge into `dev`** by `.github/workflows/bump-version-on-merge.yml`. **Do not edit `app/VERSION` in ordinary PRs** — two open PRs that both edit it always conflict (TD-196).
2. **When you ship a breaking change → set MAJOR** (e.g. `1.4.2` → `2.0.0`) by editing `app/VERSION` in that PR. A PR that edits the file itself is not auto-bumped.
3. **When you ship a significant non-breaking feature set → set MINOR** (e.g. `1.4.2` → `1.5.0`) the same way.
4. The bump commit is `[skip ci]`, so a deploy builds the previous number and the new one ships with the next merge.

## ⭐ Current status & product source of truth (read before anything else)

- **Status (2026-10-30):** store release is **paused**. Focus: precise spec, architecture, and go-to-market. Development continues in Claude Code against this repo.
- **Product source of truth:** the PM's Hebrew project book ("KC – ספר הפרויקט (מקור אמת)", product decision D35). Its English, agent-oriented derivation is [`docs/spec/`](./docs/spec/README.md) — start at its README. Where `docs/spec/` and a legacy `docs/spec/requirements/*` FR conflict, **`docs/spec/` wins**; reconcile the legacy file in the same PR.
- **Architecture:** [`docs/architecture/`](./docs/architecture/README.md) — current (from code) and target.
- **ID namespaces:** product decisions are `D#` (in `docs/spec/90_decisions_log.md`); engineering decisions are `D-*` / `EXEC-*` (in `docs/SSOT/DECISIONS.md`). KC fills pending approval are `S#`; implementation gaps are `G#`. **New entries never pick a number** — they take a merge-time placeholder (§4 "New registry IDs").

### Working rules (PM-mandated)
1. **Spec is the source of truth.** Spec first, then task, then code.
2. **Every task or bug = code + spec section + automated test.** Cite the `docs/spec` section (and legacy FR-ID if any). Every bug fix ships a regression test that fails before the fix.
3. **Meaningful names** in code and in product language: "giving world", "item subcategory", "post type" — **never a bare `categories`** / generic names. Follow [`docs/spec/94_glossary_and_naming.md`](./docs/spec/94_glossary_and_naming.md).
4. **`PRD_V2_NOT_FOR_MVP/` is a treasure** — long-horizon vision. **Never archive, move or delete it.** Don't implement from it unless the spec links there; mine it when specifying later phases.
5. **Secrets never in the repo** — reference secrets by *name* only (e.g. GitHub Environment secret names). No tokens, keys, personal emails or real user data in docs, code, tests or PR bodies.
6. **Never describe security vulnerabilities publicly** (issues, PRs, docs, commit messages). Report them privately to the PM.
7. Decisions taken in chat with the PM are written into `docs/spec/` (every affected section + `90_decisions_log.md`) in the same PR.

### Standing goals (product decision D58)
1. Continuous spec maintenance at every level (project book, PRD, SRS, technical docs).
2. First release to the Apple App Store and Google Play, then continuous version updates.
3. Professional, efficient, modular, scalable code.

## Quick Start

1. **Product focus.** KC mobile + web export (`app/apps/mobile/**`) and shared Supabase backend — see [`AGENTS.md`](./AGENTS.md).
2. **Read order.**
   0. `node scripts/spec.mjs --changed` — what moved in the spec on `dev` since your branch was cut (§2)
   1. [`docs/spec/README.md`](./docs/spec/README.md) — product project book (source of truth) and the section for your area
   2. The [GitHub project board](https://github.com/orgs/KarmaCummunity/projects/2) — the **only** task queue ([`docs/process/PROJECT_BOARD.md`](./docs/process/PROJECT_BOARD.md)); `docs/SSOT/BACKLOG.md` is just an old-ID → issue map
   3. Relevant [`docs/spec/requirements/{domain}.md`](./docs/spec/requirements) for FR-IDs / ACs
   4. Scan the open `tech-debt` issues for the area you touch (`gh issue list -R KarmaCummunity/KC -l tech-debt`)
   5. Check [`docs/SSOT/DECISIONS.md`](./docs/SSOT/DECISIONS.md) before structural changes
3. **Do not implement from.** `docs/SSOT/archive/**`, `PRD_V2_NOT_FOR_MVP/**` (vision treasure — never archive it), and design/plan trees under `docs/SSOT/archive/superpowers/**` — unless an **open** backlog row or active spec links there.
4. **Pre-push gates** (from `app/`): `pnpm typecheck && pnpm test && pnpm lint`
5. **Version.** Do not bump `app/VERSION` in ordinary PRs; it is bumped on merge (see banner above).

Doc map for humans: [`docs/README.md`](./docs/README.md).

## 1. Required reading (before doing anything)

0. **`docs/spec/`** — product project book (vision → worlds/domains → cross-cutting systems → governance/GTM/roadmap), D1–D66. Wins over legacy FR files.
1. **`docs/spec/requirements/{domain}.md`** — per-domain requirements (FR-IDs, ACs). Each file is the full spec (FR-IDs, ACs, business rules) plus a status header (✅/🟡/⏳). Read only the file relevant to your task.
2. **The GitHub project board** (<https://github.com/orgs/KarmaCummunity/projects/2>) — the only task queue (what's next, who owns it). Workflow: `docs/process/PROJECT_BOARD.md`.
3. **GitHub issues labeled `tech-debt`** — active technical debt (old `TD-n` IDs stay in the issue title). Scan items in the area you're touching before opening a PR; close adjacent debt opportunistically when scope is small.
4. **`docs/SSOT/DECISIONS.md`** — architecture & product decisions (D-* and EXEC-*). Check before proposing structural changes.

### Spec files (domain-per-file)

```
docs/spec/requirements/
├── 01_auth_and_onboarding.md     FR-AUTH-*
├── 02_profile_and_privacy.md     FR-PROFILE-*
├── 03_following.md               FR-FOLLOW-*
├── 04_posts.md                   FR-POST-*
├── 05_closure_and_reopen.md      FR-CLOSURE-*
├── 06_feed_and_search.md         FR-FEED-*
├── 07_chat.md                    FR-CHAT-*
├── 08_moderation.md              FR-MOD-*
├── 09_notifications.md           FR-NOTIF-*
├── 10_statistics.md              FR-STATS-*
├── 11_settings.md                FR-SETTINGS-*
├── 12_super_admin.md             FR-ADMIN-*
├── 13_donations.md               FR-DONATE-*
├── 14_karma.md                   FR-KARMA-*
├── 15_rides.md                   FR-RIDE-*
├── 16_public_research.md         FR-RESEARCH-*
├── 17_responsive_desktop.md      FR-RESP-*
├── 18_translation.md             FR-TRANSLATE-*
├── 19_org_finance.md             FR-FIN-*
├── 20_organizations.md           FR-ORG-*
├── 21_housing.md                FR-HOUSING-*
├── 22_identity_verification.md  FR-VERIFY-*
├── 23_knowledge.md              FR-KNOW-*
└── 24_ride_event_groups.md      FR-EVRIDE-*
```

Note: `17_responsive_desktop.md` was formerly `14_responsive_desktop.md` (renamed 2026-10-30 to remove the duplicate `14_` and fill the missing `17_`). FR-RESP-* IDs are unchanged.

## 2. Spec Validation Gate

**Always read the spec from `dev`, never from your working tree.** A checkout or worktree can be days behind, and another agent may have changed the spec since. Use the reader, which fetches `dev` first:

```bash
node scripts/spec.mjs --changed        # spec files that moved on dev since your branch was cut
node scripts/spec.mjs 04_posts         # one file, as merged on dev (also: a path, a number, an FR-ID like FR-POST-004)
node scripts/spec.mjs --list           # every spec file on dev
```

If `--changed` lists a file you are about to rely on, merge `origin/dev` into your branch before you touch it. The issue you work on carries its own acceptance criteria; they win over a stale local copy.

Before implementing ANY user request:

1. **Read** the relevant requirements file with `node scripts/spec.mjs <domain>` (for example `node scripts/spec.mjs 04_posts`).
2. **Compare** the request against existing ACs.
3. **If contradiction found** → STOP and report:
   > ⚠️ הבקשה שלך סותרת את האפיון:
   > - אפיון: [quote from spec]
   > - בקשה: [what you asked]
   > האם לעדכן את האפיון? (כן/לא)
   - If user approves → update spec FIRST, then implement.
   - If user rejects → implement as-is, note deviation.
4. **If new feature (not in spec)** → report: "הפיצ'ר הזה לא מופיע באפיון. להוסיף?"
5. **After implementation** → update status in spec: ⏳ → ✅.

## 3. Verification gate

Every response that includes code must begin with:

```
Mapped to spec: [FR-ID]. Refactor logged: [Yes/No/NA].
```

Use `NA` for pure tooling / docs / infra-only changes.

## 4. SSOT update workflow

### Before you start any feature work

1. Open the board (`docs/process/PROJECT_BOARD.md`) — confirm the feature isn't already done, and pick the top **Ready** item nobody owns if none was assigned. Never work on an item that is claimed (`in-progress` label) or **In progress**.
2. Read the matching requirements file from `dev`: `node scripts/spec.mjs <domain>` (§2).
3. Claim the issue per [`docs/agents/ISSUE_CLAIMS.md`](./docs/agents/ISSUE_CLAIMS.md) (`in-progress` + `agent:<you>` labels) and move it to **In progress** on the board before any code edit; this is the lock that stops parallel work on the same task.

### While working

- If you discover technical debt outside the immediate scope, open an issue with the `tech-debt` label (its issue number is its ID). Do **not** refactor inline.
- If a product/architecture decision is made on the fly, append it to `docs/SSOT/DECISIONS.md`, with a placeholder ID (below).

### New registry IDs (assigned on merge)

Parallel branches that each take "the next free number" collide. So a PR **never writes a new number** for a registry entry; it writes a placeholder `{{KEY:slug}}` (lowercase kebab slug, unique within its registry) in the entry's ID cell or heading, and cites that same placeholder anywhere else (other docs, code comments, the PR body).

| Registry | Placeholder | Becomes |
| -------- | ----------- | ------- |
| `docs/spec/90_decisions_log.md` | `{{D:slug}}` | `D93` |
| `docs/spec/91_kc_fills_pending.md` | `{{S:slug}}` | `S52` |
| `docs/spec/93_implementation_gaps.md` | `{{G:slug}}` | `G50` |
| `docs/SSOT/DECISIONS.md` (`## …` heading) | `{{ENG:slug}}` | `D-200` |

After the merge into `dev`, `bump-version-on-merge.yml` runs `node scripts/spec-ids.mjs assign`: every placeholder becomes the next free number of its registry and every citation is rewritten, in a commit of its own that CI certifies (the version bump stays a separate `app/VERSION`-only commit, TD-231). `node scripts/spec-ids.mjs check` (in `pnpm lint:arch` and CI static guards) fails on a duplicate number or a placeholder without exactly one entry. Existing numbers are never renumbered.

### Before you call the work done

You MUST update SSOT docs in the **same** change-set as your code:

1. **The issue**: the PR body has `Closes #N` (Done happens on merge); if the work is partial, leave a comment with what remains.
2. **`spec/{domain}.md`**: update the status header if all ACs for the domain are complete.
3. **Tech debt**: close resolved `tech-debt` issues (`Closes #N`) and open issues for new debt.

### What does NOT need an SSOT update

- Pure tooling changes (CI config, linter rules, dependency bumps with no behavior change).
- Documentation-only edits to spec files or this file.
- Hotfixes that don't change any AC of an `FR-*`.

### If you cannot update the board

Stop. Either you don't have write access, the feature has no issue, or scope is unclear. Surface the issue to the user before proceeding — do not silently skip the update.

## 5. Clean Architecture invariants

```
infrastructure-supabase  →  application  →  domain
       (impl)              (use cases)     (pure)
```

- **`packages/domain/`** — entities, value objects, invariants. **Zero dependencies** on `node_modules` (besides `typescript` dev-dep), zero imports from `application` or `infrastructure-*`. Entities prefer `readonly` fields.
- **`packages/application/`** — use cases (one file per use case), repository / service ports (`I*.ts` interfaces). May depend on `@kc/domain`. **No I/O, no Supabase, no React.**
- **`packages/infrastructure-supabase/`** — adapters that implement application ports. Owns Supabase, network, storage. **Never imported from `domain` or `application`.**
- **`packages/ui/`** — design tokens, shared components. May depend on React Native primitives but not on `domain` business rules.
- **`apps/mobile/`** — composition root: instantiates infrastructure, injects into use cases, wires to React.

If you catch yourself importing `@kc/infrastructure-supabase` or `@supabase/supabase-js` from a `domain` or `application` file, **stop and revert** — push the integration to a port + adapter.

Full C4 diagrams and package boundary matrix: [`docs/architecture/current.md`](./docs/architecture/current.md).

### Hard constraints

- **File size cap**: ≤ 300 lines per file. Split if you exceed. Enforced by `pnpm lint:arch`.
- **Indentation cap**: ≤ 3 levels. Extract if deeper.
- **Cyclomatic complexity**: prefer many small functions over one large one.
- **No speculative abstractions** (YAGNI). No "nice-to-have" generalization unless an FR demands it.
- **Minimal-footprint edits**: prefer atomic, localized changes. Don't rewrite a function to fix one branch.

### Error handling

- Domain code throws domain-specific error classes (e.g., `AuthError`, `PostError`). Never raw `Error`.
- Application/infrastructure layers catch domain errors and map to user-visible states (UI alerts, toasts) or HTTP responses (Edge Functions).
- Stack traces never leak to the UI or to API consumers.

### "Propose and Proceed" rule

When you spot tech debt outside the immediate scope:

1. Open an issue with the `tech-debt` label.
2. Continue the original task. **Do not refactor inline.**

### Testing protocol

- Any new domain or application code ships with unit tests beside it (`__tests__/` directory inside the package).
- Mobile UI journeys are covered by Maestro flows on Android (`.maestro/flows/`, CI `ci-maestro-android.yml`). A UI bug fix starts with a failing flow. Runbook: [`docs/process/MAESTRO.md`](docs/process/MAESTRO.md).
- Tests cover both happy path and at least one boundary / error condition.
- Test runner: `vitest`. Run with `pnpm --filter @kc/<package> test`.

## 6. Git & PR workflow

### Issue claims (multi-agent)

Before starting an issue: skip it if it has `in-progress` or an open PR references it. Otherwise claim it (`in-progress` + your `agent:claude|cursor|codex|antigravity|kc-bot` label, comment `claimed by <agent>`). Release on abandon; merge releases automatically. Claims older than 6 hours with no open PR are stale. Full rule: [`docs/agents/ISSUE_CLAIMS.md`](docs/agents/ISSUE_CLAIMS.md).

Every PR you open gets exactly one opened-by label (`agent:claude|cursor|kc-bot|antigravity|codex|other` or `human`) and the matching `Opened by:` line in the PR body; `pr-opened-by.yml` checks it.

> Repo: `KarmaCummunity/KC` · Default branch: `main` · Merge strategy: **squash** · Auto-merge: **on** — `dev` merges through a merge queue once the single required check **`CI gate`** passes.
> **Working branch: `dev`.** All PRs target `dev`. `main` is updated by a `dev` → `main` release PR (squash-merged). Full topology in [`docs/SSOT/ENVIRONMENTS.md`](docs/SSOT/ENVIRONMENTS.md).

### Pre-flight (once per session)

```bash
gh --version              # GitHub CLI installed
gh auth status            # Logged in to github.com
git config user.name      # non-empty
git config user.email     # non-empty
gh repo view --json nameWithOwner -q .nameWithOwner   # KarmaCummunity/KC
```

If any check fails, stop and point the user to `SETUP_GIT_AGENT.md`. Do not improvise.

### Change classes

| Class                 | Trigger                                              | Direct push to `main`?  |
| --------------------- | ---------------------------------------------------- | ----------------------- |
| **`hotfix-trivial`**  | Typo in docs / comment / string. No code logic.      | Allowed (with caution)  |
| **`feature`**         | Anything tied to an `FR-*` or user-visible.          | **Forbidden** — PR only |
| **`fix`**             | Bug fix that changes runtime behavior.               | **Forbidden** — PR only |
| **`refactor`**        | Internal restructure, no behavior change.            | **Forbidden** — PR only |
| **`chore`**           | Tooling, deps, CI, configs.                          | **Forbidden** — PR only |
| **`docs`**            | Doc-only edit larger than a single line / typo.      | **Forbidden** — PR only |

When in doubt, open a PR.

### `main` production gates (`D-195`)

A prod deploy needs one human step: the owner's approval on the `production` environment. Before every `dev` → `main` release PR:

1. `CI gate` green, including its **release** lane (`dev` head branch, strict migration scan, `app/VERSION` above the latest tag, dev E2E on the release head).
2. Migrations must be backward-compatible; destructive SQL (`DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, unqualified `DELETE`) fails CI unless the line includes `migration-safety: allow` with justification in the PR body.
3. After merge: **Deploy** (`deploy.yml`) waits for one owner approval, then backs up prod, dry-runs and applies migrations, deploys functions and web, and smoke-tests.
4. Never mutate prod SQL outside `supabase/migrations/` + the **Deploy** workflow. PM confirmation for ad-hoc SQL (§7) still applies if a human operator runs SQL manually.

Details: [`docs/SSOT/RELEASE_CHECKLIST.md`](docs/SSOT/RELEASE_CHECKLIST.md), [`docs/SSOT/ENVIRONMENTS.md`](docs/SSOT/ENVIRONMENTS.md) § Deploy pipeline.

### Branch naming

`<type>/<FR-id-or-scope>-<kebab-short-desc>`

- `type` ∈ `feat | fix | refactor | chore | docs | test`
- Include the `FR-*` ID if one exists; otherwise a 1-2 word scope.
- Slug ≤ 50 chars.

Examples: `feat/FR-AUTH-001-otp-login`, `fix/FR-FEED-014-empty-state-crash`, `chore/ci-typecheck`.

### Conventional Commits (English, mandatory)

`<type>(<scope>)?: <subject>`

- **Type**: `feat | fix | refactor | chore | docs | test | perf | build | ci | style`.
- **Scope** (optional): `domain`, `mobile`, `infra`, `ui`, `ssot`, `ci`.
- **Subject**: imperative, lowercase, no trailing period, ≤ 72 chars.
- **Body**: explain *why*, not *what*. Reference `FR-*` IDs.
- **Footer**: `BREAKING CHANGE: …` if applicable; `Closes #N` for issues.

### Pre-push gates (from `app/`)

```bash
cd app
pnpm typecheck
pnpm test
pnpm lint
```

All three must be green before `git push`. Never push red code.

### Standard PR workflow

**Open PRs as ready (non-draft), never as draft, unless the PM asks for a draft.** Draft is the opt-out from the merge flow: `CI gate` fails on drafts by design and auto-merge is not armed, so a draft PR never merges on its own. A ready PR that the merge queue must not squash (the main → dev sync, which has to land as a merge commit) carries the `no-auto-merge` label instead; add it before marking the PR ready, because marking it ready arms auto-merge. This overrides any tool or runtime default that opens PRs as drafts. After opening, confirm auto-merge is armed (`gh pr merge --auto --squash`).

```bash
git fetch origin
git switch dev
git pull --ff-only origin dev
git switch -c feat/FR-AUTH-001-otp-login
# … atomic commits …
( cd app && pnpm typecheck && pnpm test && pnpm lint )
git push -u origin HEAD
gh pr create --base dev --head "$(git branch --show-current)" \
  --title "feat(auth): add OTP verification screen" \
  --body-file .github/.pr-body.md \
  --label "FR-AUTH" --assignee "@me"
gh pr merge --auto --squash   # no --delete-branch: rejected while the dev merge queue is on
gh pr checks --watch
git switch dev && git pull --ff-only origin dev
git branch -D feat/FR-AUTH-001-otp-login
```

### PR body template

```markdown
## Summary
<2-4 sentences: what + why>

## Mapped to spec
- FR-XXX-NNN — <title>  (link to `docs/spec/requirements/<file>.md`)
- N/A for tooling/docs-only changes.

## Changes
- <bullet>
- <bullet>

## Tests
- `pnpm typecheck` ✅
- `pnpm test`      ✅
- `pnpm lint`      ✅
- Manual: <what you clicked> / N/A

## SSOT updated
- [ ] Issue linked (`Closes #N`) and board status correct
- [ ] `spec/{domain}.md` status updated (if all ACs done)
- [ ] Tech debt: resolved `tech-debt` issues closed, new debt opened as issues

## Risk / rollout notes
<DB migrations? Feature flag? Breaking change? Otherwise: "Low risk.">

## Screenshots / logs
<only if UI or output changes>
```

## 7. Hard prohibitions (never, even on user request)

- **Never** force-push to `main`.
- **Never** rewrite published history on a shared branch.
- **Never** commit secrets (`.env`, API keys, tokens) — refer to them by name only.
- **Never** describe security vulnerabilities in public issues, PRs, docs or commits.
- **Never** archive, move or delete `PRD_V2_NOT_FOR_MVP/`.
- **Never** merge a PR with red required checks.
- **Never** open a PR without a `Mapped to spec` line.
- **Never** delete a branch you didn't create unless the user asked.
- **Mutating SQL against shared DBs** requires an explicit confirmation procedure: the user must type the literal post-confirmation string the agent quoted. No exceptions.

## 8. Documentation language

- Product / requirements docs (`docs/**/*.md`, including `docs/spec/requirements/*.md`, `BACKLOG.md`, `DECISIONS.md`): **English only**; FR-IDs and code paths stay English.
- Code, code comments, commit messages, PR titles/bodies: **English**. User-visible strings belong in locale files (for example `apps/mobile/src/i18n/locales/he/` — Hebrew only for MVP, `R-MVP-Core-4`), not inline in general source.
- Agent ↔ PM conversation: Hebrew (per project preference).

## 9. Parallel-agents protocol

When two agents are running concurrently:

- **BE lane** owns `supabase/**` + `packages/infrastructure-supabase/**`.
- **FE lane** owns `apps/mobile/**` + `packages/ui/**`.
- **Shared contract** (`packages/{domain,application}/**`): FE leads domain types, BE leads port signatures. Contract changes ship as their own commit with `(contract)` scope (e.g. `feat(contract): add IPostRepository.list`).
- Branch naming: `<type>/<FR-id-or-scope>-<be|fe>-<slug>` (e.g. `feat/FR-POST-001-fe-feed-ui`).
- **Applying dev migrations (BE lane).** Schema changes reach the dev DB ONLY as committed sequential files (`supabase/migrations/NNNN_snake.sql`) applied via `supabase db push` / `supabase migration up` (or the **Deploy** workflow after a `dev` push passes CI). **Never** apply schema changes to dev with the Supabase MCP `apply_migration` tool — it records a TIMESTAMP version (e.g. `20260701130827`) that has no local file, which breaks the next `DB deploy` run ("Remote migration versions not found …"). The MCP `execute_sql` tool is fine for read-only inspection. Drift is caught by the `CI — migration drift` workflow; reconcile with `node scripts/reconcile-migration-drift.mjs`. Full runbook: [`docs/SSOT/OPERATOR_RUNBOOK.md`](docs/SSOT/OPERATOR_RUNBOOK.md) → "Migration application rules".

## 10. How to pick the next task

Release is paused (see top), so priorities are:
1. **Assigned task** from the PM — always first.
2. **Spec work** — closing open questions / `S#` approvals in `docs/spec/92_open_questions.md` and `91_kc_fills_pending.md` only with the PM.
3. **Implementation gaps** in `docs/spec/93_implementation_gaps.md` (`G#`) the PM has prioritized — each as a task with code + spec section + automated test.
4. Otherwise: the top **Ready** item on the GitHub board that nobody owns and that does not contradict `docs/spec/`. Claim it (`docs/agents/ISSUE_CLAIMS.md`) and move it to **In progress** before you start coding.

## 11. Tech stack quick reference

- Monorepo: pnpm + turbo. From `app/`: `pnpm install` then `pnpm typecheck` / `pnpm test` / `pnpm lint`.
- Run: `pnpm ios` / `pnpm android` / `pnpm --filter @kc/mobile web`.
- Mobile: Expo + React Native + expo-router (typed routes), Hebrew RTL forced.
- Backend: Supabase (Auth, Postgres+RLS, Storage, Realtime, Edge Functions).
- Layers: `packages/{domain,application,infrastructure-supabase,ui}` + `apps/mobile`. Strict inward dependency direction.

## 12. Repo structure map

If you don't see a home for something below, **ask the PM** before inventing a new file. Do not create new top-level docs without explicit approval.

| Concern                   | File / directory                       |
| ------------------------- | -------------------------------------- |
| **App semver (`x.x.x`)**  | **`app/VERSION`** (see banner § above) |
| Task queue                | GitHub project board (`docs/process/PROJECT_BOARD.md`) |
| Project board workflow    | `docs/process/PROJECT_BOARD.md`        |
| **Product project book**  | **`docs/spec/`** (English; Hebrew page is the human source of truth) |
| Architecture (current/target) | `docs/architecture/`               |
| Feature specs (FR-*)         | `docs/spec/requirements/{domain}.md`        |
| Long-horizon vision       | `PRD_V2_NOT_FOR_MVP/` (never archive)  |
| Tech debt                 | GitHub issues labeled `tech-debt`      |
| Architectural decisions   | `docs/SSOT/DECISIONS.md`               |
| Migration verification    | `docs/SSOT/OPERATOR_RUNBOOK.md`        |
| Environment topology      | `docs/SSOT/ENVIRONMENTS.md`            |
| **Process rules**         | **`AGENTS.md`** (this file)            |
| `docs/agents/`            | Operating runbooks (flow, deploy, release, claims) |
| Implementation plans      | `docs/SSOT/archive/superpowers/plans/` (historical) + new plans land there until SSOT says otherwise |
| Design specs              | `docs/SSOT/archive/superpowers/specs/` (historical) |
| Historical archive        | `docs/SSOT/archive/`                   |
| `.cursor/rules/*.mdc`     | Thin pointers to `AGENTS.md` (kept only so Cursor's `alwaysApply: true` resolves) |
| `CLAUDE.md` (root)        | One line: `@AGENTS.md` (Claude Code import) |

## 13. Autonomous loop mode

When this section is active, the agent operates as a continuous self-driven task loop targeting the `dev` branch. The PM is hands-off; the agent is expected to keep producing PRs until externally halted.

### Activation & halt

- **Opt-in per environment.** The Stop hook in `.claude/settings.json` only fires when `.claude/LOOP_ENABLED` exists (gitignored). To start the loop in a checkout: `touch .claude/LOOP_ENABLED`. To disable permanently: delete the file.
- **Within an active session**, iterations are kept alive by ScheduleWakeup (primary) and the Stop hook (backstop). The agent calls `ScheduleWakeup(60s, "Continue autonomous loop per AGENTS.md §13.")` before ending every turn.
- **Halt mechanisms** — any one stops the loop cleanly:
  1. `touch .claude/HALT_LOOP` — Stop hook honors it and lets the turn end. Loop stays armed; remove the file to resume.
  2. `rm .claude/LOOP_ENABLED` — disarm the loop entirely until re-enabled.
  3. PM presses Esc / interrupts a turn. The agent must not auto-resume the same task that was just interrupted; pick a different one next iteration.
  4. Token / quota exhausted (hard external limit).
- **Runtime sentinels** (all gitignored, never committed):
  - `.claude/LOOP_ENABLED` — opt-in marker. Loop is off until this exists.
  - `.claude/HALT_LOOP` — temporary pause marker. Honored by Stop hook.
  - `.claude/AUTONOMOUS_LOOP_LOG.md` — append-only log of iteration outcomes.

### Iteration cycle

1. **Pick next work** in this priority order:
   1. Top **Ready**, Agent-ready item on the GitHub board that nobody owns (`priority:launch` > P0 > P1 > P2 > P3). `priority:launch` is everything required for the upcoming launch, above P0: **Rides** and **Items** end-to-end flows first, then other launch blockers (auth, crashes, store readiness).
   2. If none remain: highest-priority open `tech-debt` issue nobody has claimed.
   3. If both empty: SSOT documentation polish, adjacent dead-code removal, or test-coverage gaps surfaced by `pnpm test` in `app/`.
2. **Claim the issue (`docs/agents/ISSUE_CLAIMS.md`) and set it to In progress** before any code edit.
3. **Branch from latest `origin/dev`**: `<type>/<FR-id-or-scope>-<slug>` per §6.
4. **Implement** under all constraints in §1–§5 (spec validation, clean architecture, file/indent caps, error handling).
5. **Verify locally** before push: from `app/` run `pnpm typecheck && pnpm test && pnpm lint`. All three green or do not push.
6. **PR to `dev`** with `gh pr create --base dev` then `gh pr merge --auto --squash` (no `--delete-branch`: rejected while the `dev` merge queue is on). Body follows the §6 template, including the `Mapped to spec` line.
7. **CI watch.** If CI fails: up to 3 fix attempts on the same PR. If still red after 3, investigate CI itself (workflow drift, flake, env mismatch) — fix it in-scope. Only after CI repair also fails twice do you close the PR with a blocker note and skip to the next task; the blocked item is opened as a `tech-debt` issue with a clear reproducer.
8. **Update SSOT in the same PR**: `Closes #N` in the PR, `spec/<domain>.md` status header if all ACs done.
9. **Append to `.claude/AUTONOMOUS_LOOP_LOG.md`**: `<ISO-timestamp> | <branch> | <PR url> | <merged|closed|blocked> | <one-line outcome>`.
10. **Schedule next iteration**: call `ScheduleWakeup(delaySeconds=60, prompt="Continue autonomous loop per AGENTS.md §13.")` before ending the turn. The Stop hook is a backstop only — do not rely on it alone.

### Authorities granted under this mode (`dev` scope only)

- **Product decisions**: when a task forks on UX/product, decide based on user-visible coherence + simplicity. Record the call in `docs/SSOT/DECISIONS.md` as a new `D-*` entry with a one-paragraph rationale. Do not block on PM input.
- **CI / tooling repairs**: if `.github/workflows/*`, root configs, or monorepo tooling appear broken, fix as part of the loop — CI is in-scope.
- **Dev Supabase database**: full read/write/migration authority on project `enbqriuxvvuontiwslun` (kc-dev; verified 2026-10-30 against the deployed dev web bundle, matches `docs/SSOT/ENVIRONMENTS.md`) via Supabase MCP tools and the local CLI. `roeefqpdbftlndzsvhfj` ("MVP-2") and `slxijdfvinbjmrsfgbzx` ("MVP-PROD") are older, paused projects — never target them. Migrations live in `supabase/migrations/` and ship in the same PR as their consumers. Secrets needed by the CLI are in `~/.kc-dev-secrets.env` (outside the repo).

### Still prohibited (§7 holds regardless of loop mode)

- Direct push to `main`, force-push anywhere, history rewrites on shared branches.
- Committing `.env*` files or any secret. Use `~/.kc-dev-secrets.env` for shell sourcing.
- Mutating SQL on the production Supabase project (different ref). Dev project only.
- Merging a PR with red required checks.
- Opening a PR without the `Mapped to spec` line.

### Blocker handling

A task is *blocked* (vs. failed) only when it strictly requires an action the agent cannot perform:
- Requires PM to obtain an external credential or sign a contract.
- Requires a `main` push or production DB write.
- Hits two consecutive product-decision forks where both paths conflict with existing SSOT and only the PM can adjudicate.

For a blocker: close any open PR with a labeled comment, set the issue to **Blocked** with a comment giving the exact need and release your claim, open a `tech-debt` issue if non-trivial, log to `AUTONOMOUS_LOOP_LOG.md`, then start the next iteration. Do not idle the loop.
