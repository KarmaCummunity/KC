# Issue claims

Several AI agents (Claude Code, Cursor, Codex, Antigravity, KC bot workers) work this repo. Claims keep two agents off the same issue.

The full claim-to-merge procedure, including these claim steps, is the [`kc-issue-to-merge`](../../.claude/skills/kc-issue-to-merge/SKILL.md) skill.

Labels: `in-progress` plus one of `agent:claude`, `agent:cursor`, `agent:codex`, `agent:antigravity`, `agent:kc-bot`.

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

## Labeling PRs (opened by)

Every PR carries exactly one label naming who opened it: `agent:claude`, `agent:cursor`, `agent:kc-bot` (Grok Bot), `agent:antigravity`, `agent:codex`, `agent:other` (Dependabot and other tools) or `human`.

- Add it when you open the PR: `gh pr create ... --label agent:<you>`, and set the `Opened by:` line in the PR template to the same value.
- `pr-opened-by.yml` fails the PR if it has none or more than one of these labels. If none is set, it applies the label from the `Opened by:` line when that line names exactly one option.
