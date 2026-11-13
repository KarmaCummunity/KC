---
description: Work a KarmaCummunity/KC issue end to end with the kc-issue-to-merge skill
argument-hint: "[<issue number> | loop [<merged-issue budget>]]"
---

Run the `kc-issue-to-merge` skill (`.claude/skills/kc-issue-to-merge/SKILL.md`) as agent `claude`, with: `$ARGUMENTS`

- Empty: take the next issue from the queue (`node scripts/agent-task.mjs next`).
- A number, with or without `#`: work that issue.
- `loop`, optionally with a number: run the loop of `references/loop.md`, stopping after that many merged issues.
