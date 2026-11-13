---
description: Work a KarmaCummunity/KC issue end to end with the kc-issue-to-merge skill
---

1. Read `.claude/skills/kc-issue-to-merge/SKILL.md` and follow it as agent `antigravity` (label `agent:antigravity`).
2. Use what follows `/kc` to choose the run:
   - Nothing: take the next issue from the queue (`node scripts/agent-task.mjs next`).
   - A number, with or without `#`: work that issue.
   - `loop`, optionally with a number: run the loop of `.claude/skills/kc-issue-to-merge/references/loop.md`, stopping after that many merged issues.
