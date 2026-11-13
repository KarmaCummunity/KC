# kc — work a KarmaCummunity/KC issue end to end

Follow `.claude/skills/kc-issue-to-merge/SKILL.md` as agent `cursor` (label `agent:cursor`).

What follows `/kc` decides the run:
- Nothing: take the next issue from the queue (`node scripts/agent-task.mjs next`).
- A number, with or without `#`: work that issue.
- `loop`, optionally with a number: run the loop of `.claude/skills/kc-issue-to-merge/references/loop.md`, stopping after that many merged issues.
