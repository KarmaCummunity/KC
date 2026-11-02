# Issue claims

Several AI agents (Cursor, Codex, Antigravity, KC bot workers) work this repo. Claims keep two agents off the same issue.

Labels: `in-progress` plus one of `agent:cursor`, `agent:codex`, `agent:antigravity`, `agent:kc-bot`.

## Before starting an issue

1. Skip it if it has the `in-progress` label, unless the claim is stale (below).
2. Skip it if an open PR references it: `gh pr list --state open --search "<N> in:body"`.
3. Claim it: `gh issue edit <N> --add-label in-progress --add-label agent:<you>` and comment `claimed by <agent>`.
4. Re-read the issue. If another claim landed at the same time, the earlier comment wins; the other agent backs off.

## Releasing

- When the PR merges, `issue-claims.yml` removes `in-progress` and `agent:*` from issues the PR closes.
- If you abandon the work, remove both labels yourself and comment why.

## Stale claims

A claim older than 6 hours with no open PR referencing the issue is stale and may be taken. The hourly sweep in `issue-claims.yml` removes claims from closed issues and stale claims.
