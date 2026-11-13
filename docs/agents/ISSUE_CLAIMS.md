# Issue claims

Several AI agents (Claude Code, Cursor, Codex, Antigravity, KC bot workers) work this repo. Claims keep two agents off the same issue.

The full claim-to-merge procedure, including these claim steps, is the [`kc-issue-to-merge`](../../.claude/skills/kc-issue-to-merge/SKILL.md) skill.

Labels: `in-progress` plus one of `agent:claude`, `agent:cursor`, `agent:codex`, `agent:antigravity`, `agent:kc-bot`.

## Before starting an issue

1. Skip it if it has the `in-progress` label, unless the claim is stale (below).
2. Skip it if an open PR references it: `gh pr list --state open --search "<N> in:body"`.
3. Claim it with `node scripts/agent-task.mjs claim <N> --agent <you>`. It runs checks 1 and 2, adds `in-progress` and `agent:<you>`, and comments `claimed by agent:<you> (session <id>)`.
4. The earliest claim comment after the last `released by` comment wins, unless its session later commented `withdrawn by` (it lost a race). All agents post as one GitHub user, so the session id, not the author, tells two sessions apart. The helper re-reads the comments after a short pause, then prints `WON`, or withdraws and prints `LOST`.
5. A claim whose labels were removed without a release comment (a stale sweep or a merge) is voided by the next claimer with a `released by agent-task` comment, so it cannot win.

Without `gh`, do the same REST calls by hand (`.claude/skills/kc-issue-to-merge/references/setup.md`, "Without the helper").

## Releasing

- When the PR merges, `issue-claims.yml` removes `in-progress` and `agent:*` from issues the PR closes.
- If you abandon the work, or the PR only `Refs` the issue: `node scripts/agent-task.mjs release <N> --agent <you> [--blocked "<reason>"]`. It refuses a claim another agent holds unless you pass `--force`.

## Stale claims

A claim older than 6 hours with no open PR referencing the issue is stale and may be taken. The hourly sweep in `issue-claims.yml` removes claims from closed issues and stale claims.

## Labeling PRs (opened by)

Every PR carries exactly one label naming who opened it: `agent:claude`, `agent:cursor`, `agent:kc-bot` (Grok Bot), `agent:antigravity`, `agent:codex`, `agent:other` (Dependabot and other tools) or `human`.

- Add it when you open the PR: `gh pr create ... --label agent:<you>`, and set the `Opened by:` line in the PR template to the same value.
- `pr-opened-by.yml` fails the PR if it has none or more than one of these labels. If none is set, it applies the label from the `Opened by:` line when that line names exactly one option.
