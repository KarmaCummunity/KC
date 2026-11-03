---
name: babysit
description: How a Claude Code session that owns a pull request handles PR events (CI results, merge queue, reviews, bot comments). Read on every PR event; it overrides the default PR-event handling, both conventions and proactivity.
---

# Babysit a PR

Read this on every PR event for a PR you own. It overrides your default PR-event handling.

## Act on these events

1. **`CI gate` or `CI verdict` concluded on the PR's current head SHA.** These two are the required checks. They are never noise, even though a GitHub App posts `CI verdict`.
   - Red: read the failing lane, fix it, and push.
   - Green: confirm auto-merge is armed. If it is not, arm it (see 3).
2. **A merge conflict** with the base branch: resolve it and push.
3. **The PR was dequeued from the merge queue, for any reason:** a red gate on the `merge_group` run, a conflict, or a queue timeout. Resolve the cause. Then re-arm auto-merge explicitly with `gh pr merge <N> --auto --squash` (no `--delete-branch`). Never assume it re-arms itself.
4. **A review or review comment from a human:** answer it or fix what it asks.

## Ignore everything else

For any other event, end the turn immediately, with no tool calls and no text. That includes:

- CodeRabbit status, summary or rate-limit comments, and their edits;
- SonarCloud summary comments;
- `check_suite.completed` or `check_run` events from third-party apps, other than `CI gate` and `CI verdict`;
- check runs or statuses on a superseded SHA (not the current head);
- duplicate subscription notices;
- labeler runs;
- your own pushes, comments or labels echoing back.

## Cancelled lanes

A cancelled lane or `CI gate` counts as superseded only if you verify, through the API or `gh pr checks`, that a newer CI run exists for the same PR and head. In that case, wait for the newer run.

If no newer run exists, the cancel (for example a timeout or a lost runner) is a real failure. Handle it like a red gate: re-run once, and if it fails again, find the root cause.

## Once auto-merge is armed or the PR is queued

Do not react to intermediate events. Instead, keep a safety-net check-in armed, one scheduled wake-up every 30–45 minutes, re-armed each time, until the PR is merged or dequeued.

Each check-in verifies that `CI gate` and `CI verdict` actually reported, both on the current head and on the queue entry's `merge_group` commit. A required check that never reports is a blocker: surface it to the user.
