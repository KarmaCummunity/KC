# Project board — agent workflow

Board: <https://github.com/orgs/KarmaCummunity/projects/2>. Agents work from it; the PM only tracks progress. Rules in [`AGENTS.md`](../../AGENTS.md) still apply.

## Fields

| Field | Values |
|---|---|
| Status | Backlog, Ready, In progress, In review, Blocked, Done |
| Priority | P0–P3 |
| World | items, food, time, knowledge, money, rides, housing, experiences, Platform |
| Domain | the 11 domains in [`docs/spec/06_domain_hubs.md`](../spec/06_domain_hubs.md) (D45), or None |
| Area | mobile, backend/db, web, CI/DevOps, spec/docs, GTM |
| Size | XS–XL (estimate) |
| Agent-ready | yes = scoped enough to start without asking; no = needs triage or a human |
| Spec ref | docs/spec section, D#, G# |

The `agent-ready` **label** is different: it means "PR is done, auto-merge" (see [OPERATING_MODEL](../agents/OPERATING_MODEL.md)).

## Workflow

1. Open the **Agent queue** view (Status = Ready, Agent-ready = yes, sorted by Priority). Take the top item nobody owns.
2. Read its Spec ref (`docs/spec`, then legacy `docs/spec/requirements`) and run the spec validation gate in AGENTS.md §2. If the issue contradicts the spec or lacks acceptance criteria, set Agent-ready = no, comment why, pick another.
3. Move Status to **In progress** and assign yourself.
4. Branch from `origin/dev`; one issue = one PR to `dev`. Do not edit `app/VERSION`; PATCH is bumped automatically on merge (`TD-196`).
5. PR body: `Closes #N`, a `Mapped to spec` line, and the test results. Moving the PR in is Status **In review**.
6. Update in the same PR: the spec (`docs/spec` / `docs/spec/requirements`), and tests; new debt becomes a `tech-debt` issue.
7. Blocked on a decision, credential or dependency: Status **Blocked**, comment with the exact need. Done happens on merge.

## Rules

- **One queue.** Every task is a GitHub issue on this board; `docs/SSOT/BACKLOG.md` only maps old IDs to issues. Never start work on an item that is claimed or In progress: claiming it ([`ISSUE_CLAIMS.md`](../agents/ISSUE_CLAIMS.md)) and moving it to In progress is the lock against parallel work on the same task.
- Security issues: public text says "details shared privately" only.
- Uncertain triage defaults to Backlog + Agent-ready = no.
- New issues use the `Agent task` form ([agent-task.yml](../../.github/ISSUE_TEMPLATE/agent-task.yml)).
- Possible duplicates get the `possible-duplicate` label; only the PM closes them.
