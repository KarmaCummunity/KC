# KC agent operating model

How AI agents (and humans) ship work on KC. Rules in [`AGENTS.md`](../../AGENTS.md) still apply; this file says **who does what** and **how work flows**.

## Roles

| Role | Owns | Typical paths |
|---|---|---|
| **Coordinator** | Board, issue writing, stack order, merges to `dev` | `docs/agents/**`, GitHub Project |
| **DB** | Schema, RLS, RPCs, crons, Edge Functions, generated types | `supabase/**`, `app/packages/infrastructure-supabase/**` |
| **Mobile/UI** | Expo app, native polish, performance on device | `app/apps/mobile/**`, `app/packages/ui/**` |
| **Marketplace** | Giving worlds (money, time, items, ...), search, matching UI | `app/apps/mobile/app/**` marketplace routes + their RPCs |
| **Bot** | WhatsApp bot, MCP/bot API | `supabase/functions/whatsapp*/**`, bot packages |
| **QA/Reviewer** | Review PRs, run tests, verify on kc-dev, file bugs | any (read), `tests/**` |

One agent = one issue at a time. Don't edit paths owned by another role without saying so in the PR.

## Flow

```

issue (agent_task form) -> branch from origin/dev -> PR to dev -> CI green
  -> ready (non-draft) PR -> auto-merge (merge queue) -> Deploy (DB, functions, web, smoke) -> verify on kc-dev
```

Agents run this flow through the [`kc-issue-to-merge`](../../.claude/skills/kc-issue-to-merge/SKILL.md) skill.

1. **Issue**: use the `Agent task` form. It needs acceptance criteria, and a note on the migration (a `next-NN_slug.sql` file) if it touches SQL.
2. **Branch**: `<type>/<issue#>-<area>-<slug>`, for example `feat/905-marketplace-map`.
3. **PR**: base `dev`. The body includes `Closes #N` and `Mapped to spec` (checked by the `hygiene` lane of `CI gate`).
4. **CI**: the single required check `CI gate` is green. Don't disable or skip a gate. Fix the cause, or add a documented exception.
5. **Merge**: mark the PR ready (not draft). [`auto-merge-agent-ready.yml`](../../.github/workflows/auto-merge-agent-ready.yml) enables squash auto-merge on every non-draft PR into `dev`, and GitHub merges it through the merge queue once `CI gate` passes (no branch updates needed). It runs from `dev` alone: a secret-less `pull_request` job dispatches the workflow on `dev`, whose `agent-merge` environment (dev only) provides the App token. PRs into `main` are never auto-merged, nor is a PR labelled `no-auto-merge` (the main → dev sync, which has to land as a merge commit; add the label before marking the PR ready). Stacked PRs: merge the base first (see [STACK_MAP.md](./STACK_MAP.md)).
6. **Issues close on merge**: GitHub only honors `Closes #N` on merges into `main`, so [`close-issues-on-dev-merge.yml`](../../.github/workflows/close-issues-on-dev-merge.yml) closes the referenced issues when a PR merges into `dev` (plus a daily sweep as backstop). Use `Closes #N` only when the PR fully finishes the issue; use `Refs #N` / `Part of #N` otherwise.
7. **Deploy**: once the merge's `dev` push passes **CI**, **Deploy** (`deploy.yml`) applies migrations to kc-dev, deploys the Edge Functions and the web build (dev.karma-community.pages.dev), then runs its smoke stage. Verify there.
8. **`main` / prod (kc-prod)**: **only with Nave's explicit approval.** Agents never push to or merge into `main`, never run prod deploy workflows, and never touch kc-prod.

## Labels

- `area:*`, `database`: set automatically from paths by [`labeler.yml`](../../.github/labeler.yml).
- `agent-ready`: the author's or coordinator's signal that the PR is done and may auto-merge.
- `epic`, `size:*`: set by the coordinator.
- `found-by-agent` + `needs-triage`: an issue an agent opened from a finding outside its task. Agents never pick a `needs-triage` issue; the PM removes the label to release it to the queue. Process labels are declared in [`sync-agent-labels.yml`](../../.github/workflows/sync-agent-labels.yml).

## Weekly hygiene

[`stale-stack-report.yml`](../../.github/workflows/stale-stack-report.yml) prints open PRs into `dev` with failing checks, conflicts, or no activity for 3+ days to the job summary. The coordinator works through that list.

## Secrets

Secrets live only in encrypted GitHub environment secrets. Never print, echo, commit or paste them in issues or PRs.

## Releases

Mobile/store versioning and promotion: [RELEASE.md](./RELEASE.md).
