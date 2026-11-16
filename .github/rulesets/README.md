# Rulesets: committed templates vs. what GitHub enforces

Read from the GitHub API on 2026-11-16 (audit item 6). Re-check with
`gh api repos/KarmaCummunity/KC/rulesets` and
`gh api repos/KarmaCummunity/KC/branches/main/protection` before relying on it.

## Live (enforced)

| Branch | Mechanism | Required checks (source `integration_id`) | Other |
|---|---|---|---|
| `dev` | ruleset `dev protection (merge queue)` (id 26256421) | `CI gate` (15368, GitHub Actions) + `CI verdict` (5554385, CI-verdict App) | PR required (0 approvals), no deletion, no force push, merge queue SQUASH / ALLGREEN; bypass: repository admin role + one App (integration 5561118) |
| `main` | classic branch protection | `CI gate` (15368) + `CI verdict` (5554385), strict (up to date) | enforce admins on |
| tags `dev` / `main` | ruleset `no tags named like protected branches (D-195)` | — | from `tags-no-branch-names.json` |

GitGuardian and Snyk are deliberately **not** required contexts here: `CI gate` judges them when they report (`scripts/ci-app-checks.mjs`, see `SECURITY.md`).

So `CI verdict` **is** enforced on both `dev` and `main`, with the CI-verdict App as
its source (not just any workflow posting a check with that name).

## Templates in this folder

- `dev-main.json` is the **target** ruleset (D-195): one ruleset for `dev` + `main`,
  no bypass actors, code-owner review, stale-review dismissal, last-push approval.
  It has **not** been imported; it is stricter than the live `dev` ruleset. Its
  required checks already match the live ones (same contexts and integration ids).
  Do not loosen it to mirror the live bypass list. If you import it, keep the
  `dev` merge queue and the version-bump App bypass on a `dev`-only ruleset (see
  `docs/SSOT/OPERATOR_RUNBOOK.md`).
- `tags-no-branch-names.json` matches the live tag ruleset.
