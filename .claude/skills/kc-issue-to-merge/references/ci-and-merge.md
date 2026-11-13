# CI, merge queue and close-out

Read at Phase 9. Merging is automatic: auto-merge is armed on every ready PR into `dev`, and the merge queue squashes once `CI gate` passes. Your job is to keep the PR green and conflict-free until it merges, then close out.

## Watching

- **Claude Code:** subscribe to the PR's activity and follow `.claude/skills/babysit/SKILL.md`.
- **Other agents:** poll `CI gate` every 5–10 minutes, never in a tight loop:

  ```bash
  gh api "$R/commits/$(git rev-parse HEAD)/check-runs?per_page=100" --jq '.check_runs[] | select(.name=="CI gate" or .name=="CI verdict") | "\(.name): \(.status) \(.conclusion)"'
  ```

- **Notices about another commit.** Events can arrive late or about an older commit. Before acting, compare the event's SHA with your PR's head (`gh api $R/pulls/<PR> --jq .head.sha`).

## A red check: whose is it?

1. **Cancelled, not failed.** Editing the PR body or pushing again cancels the run in flight, and `CI verdict` then reports "not certified" for that run. Check for a newer run on the same head:

   ```bash
   gh api "$R/actions/runs?head_sha=<sha>&per_page=10" --jq '.workflow_runs[] | "\(.id) \(.name) \(.status) \(.conclusion)"'
   ```

   If one exists, wait for it. Nothing to fix.
2. **This PR's failure.** Read only the failed job's log (`gh api $R/actions/jobs/<id>/logs | grep -nE "FAIL|Error|ASSERT" | head`), reproduce it locally, fix the root cause and push. Use up to 3 attempts per cause. After that, if CI itself is broken, repair it within scope (AGENTS.md §13). After two more failures, close the PR with a comment that says what failed and why, then release as blocked.
3. **Not this PR's.** The same check is red on `dev`, or on unrelated branches, and touches nothing in your diff. Re-run the job once (`gh api -X POST $R/actions/runs/<run>/rerun-failed-jobs`).
   - **Still red:** comment once on the PR, naming the check, why it is not this PR's, and the issue or PR that fixes it, or that none exists.
   - **No issue exists for it:** open a finding.
   - **Never:** skip, retry until green, or call it a flake without evidence.

## Conflict or dequeue

- **Conflict.** Merge `origin/dev` into your branch (`git fetch origin dev && git merge origin/dev`). Never rebase a pushed branch: that needs a force push.
  - Resolve each conflict so both sides' behavior survives, and add a test where the two meet.
  - In registry files, `dev`'s numbered rows win; keep your own placeholder row next to them.
- **Dequeued.** The queue drops a PR on a conflict or a red merge-group run, and a dequeue disarms auto-merge. Fix the cause, re-run the gates and push: the push re-arms auto-merge (`auto-merge-agent-ready.yml` runs on `synchronize`). If it is still disarmed, use your runtime's tool (`gh pr merge --auto` needs GraphQL).
- **Migrations never collide.** Pending migrations are named `next-NN_slug.sql`, so parallel PRs no longer renumber each other.

## Maestro

The `maestro` lane of `CI gate` runs the Android journeys on a PR that touches the app or the flows (about 45 minutes), so a failing journey blocks the merge. When it fails, read its artifact (videos, reports) before guessing. A PR that fixes one flow among several still failing says `Refs #<N>`, so the issue stays open and claimed until every flow passes.

## Review

Answer or fix every human review comment. A bot finding is a claim to verify: fix what is real; answer what is not, with what you traced.

## Close-out after the merge

Check that it merged: `gh api $R/pulls/<PR> --jq .merged`.

| The PR said | Do |
|---|---|
| `Closes #<N>` | Confirm the issue closed and the claim labels are gone (`close-issues-on-dev-merge.yml` and `issue-claims.yml` do it). If they did not, run `node scripts/agent-task.mjs release <N> --agent <you>`. |
| `Refs #<N>`, agent work left | `release <N> --agent <you> --note <file>`. The note says what shipped, plus a checklist of what is left. |
| `Refs #<N>`, everything left waits elsewhere | `release <N> --agent <you> --blocked "<what it waits on>" --note <file>`. The queue skips it until the blocker clears. |

Then bring the branch up to `origin/dev` for the next issue (SKILL.md Phase 4) and write the final report. In a loop, append the log line (`loop.md`) and go back to Phase 1.
