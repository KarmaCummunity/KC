---
name: kc-issue-to-merge
description: Take one GitHub issue of KarmaCummunity/KC from claim to a squash-merge into dev, or run that in a loop, one issue after another. Picks or receives the issue, checks it is free and not a duplicate, claims it, sharpens it (splitting work only a person can verify into a verification issue), implements it test-first, opens findings as triage issues, opens the PR and drives it through CI and the merge queue. Use for "take an issue", "work the next task", "solve #N end to end" or the agent task loop. Agent-agnostic - Claude Code, Cursor, Codex, Antigravity and the KC bot follow the same steps with git, gh and node.
---

# KC issue to merge

**One run = one issue = one PR to `dev`, driven until it merges. Then report and stop.** A loop repeats runs: [`references/loop.md`](references/loop.md).

- **Precedence.** `AGENTS.md` holds the repo rules (spec gate, architecture, prohibitions) and wins on any conflict. This skill is the order of work; it cites those rules, not repeats them.
- **`<you>`** is your agent label suffix: `claude`, `cursor`, `codex`, `antigravity` or `kc-bot`.
- **`R=repos/KarmaCummunity/KC`.** GitHub calls are REST (`gh api`), so they also work where GraphQL is blocked. If your runtime gives GitHub tools instead of `gh`, do the same REST operation with them.

## Phase 0: Once per session

Read [`references/setup.md`](references/setup.md):
1. Run its capability probe. It tells you which fallbacks apply: no Docker, no emulator, one branch per session, no `gh`.
2. Read its permission tiers: what you may do alone, what needs the PM, and what you never do.

## Token rules (every phase)

1. **Helper first.** `node scripts/agent-task.mjs` does the queue and claim steps in one call each, with short output.
2. **Find, then read.** `rg`/glob for the symbol, then read the matching line range. Never read a whole large file, a lockfile, generated types or a migration you do not change.
3. **Spec by section, from `dev`.** Use `node scripts/spec.mjs <domain|FR-ID>`, never the whole book. For an FR-ID, check that the printed file has its `## FR-…` heading; if not, read the domain file by name.
4. **Narrow and tail.** Every `gh api` call ends in a `--jq` that keeps only the needed fields. Pipe test and build output through `tail -n 80` or `grep -E "FAIL|Error|✗"`; for CI, read only the failed job's log.
5. **Targeted before full.** Run the touched package's or file's tests while iterating; run the full gates once, before the push.
6. **Read once, delegate sweeps.** Do not re-read what you just edited or already summarized. Send broad searches to a subagent if you have one, and keep only its conclusion.
7. **Lazy references.** Open a `references/` file only when its phase starts.
8. **Stop early.** A blocked task stops exploring at once.

## Phase 1: Pick

- **Given an issue:** run `node scripts/agent-task.mjs check <N>`.
- **Otherwise:** run `node scripts/agent-task.mjs next` and take the first row; it applies the queue rules (priority order, nothing claimed, blocked, untriaged, epic or reserved for a person). Then run `check` on it.

`check` prints `claimable`, similar open issues and merged PRs. Skip the issue when any of these holds:

| Finding | Action |
|---|---|
| `claimable` is not `yes` | Take the next row. |
| A merged PR already did it | Comment the link, add `possible-duplicate`, take the next row. Only the PM closes it. |
| An open issue covers the same work | Comment on both, add `possible-duplicate`, take the next row. |
| A similar issue or PR, but its acceptance criteria differ | Not a duplicate: go on, and cite it in the PR's Summary. |
| Every acceptance criterion needs a person (device, store, credential, contract) | Comment why, add `needs-triage`, take the next row. Partly person-only is not a skip: Phase 3 splits it. |

## Phase 2: Claim

```bash
node scripts/agent-task.mjs claim <N> --agent <you>
```

| Output | Meaning |
|---|---|
| `WON` | Go on. |
| `LOST` or `SKIP` (exit code 3) | Another session holds it (the helper already backed off); go back to Phase 1. |

A claim with no open PR for 6 hours is swept. On long work, open the PR as soon as a first green commit exists.

## Phase 3: Define

Read [`references/define-and-label.md`](references/define-and-label.md). Read [`references/task-types.md`](references/task-types.md) too, unless the issue is a plain feature or bug whose every acceptance criterion CI can prove.

1. **Read** the issue (`gh api $R/issues/<N> --jq '{title, body}'`), its spec ref and that spec section. Run `node scripts/spec.mjs --changed` once; if a file you rely on moved on `dev`, merge `origin/dev` first.
2. **Spec gate** (AGENTS.md §2). Sort every gap into one of two classes:
   - **Technical gap: fill it** in a `### Filled in by agent:<you>` section of the issue.
   - **Product question: never decide it.** A feature with no spec section at all is one (AGENTS.md §2.4).
     - **PM in your conversation:** ask in Hebrew, with options and a recommendation, and write the answer into the spec.
     - **Otherwise:** release as blocked, then go to Phase 1.
3. **Split by who can verify.** Acceptance criteria only a person can verify move to a new `verification` issue (template in `task-types.md`). This issue keeps what CI proves and closes on merge.
4. **Size and labels.** `XL` becomes an epic with children: release the parent's claim, then `claim` the first child. Label the issue to the taxonomy (type, area, priority, size).

## Phase 4: Plan and branch

Read [`references/testing-matrix.md`](references/testing-matrix.md).

1. **Plan.** List the files you will change and the test levels the change needs. A bug starts with a regression test that fails before the fix.
2. **Branch.** `git fetch origin dev && git switch -c <type>/<N>-<area>-<slug> origin/dev`.
   - **Runtime-assigned branch:** use its name, still based on `origin/dev`.
   - **Its PR already merged:** if the branch exists on `origin`, `git switch <branch> && git merge origin/dev` (no force push needed); otherwise `git checkout -B <branch> origin/dev`.
3. **SQL.** A new migration is `supabase/migrations/next-NN_slug.sql`; the number is assigned on merge. Never write a number anywhere.

## Phase 5: Implement test-first

- **Order.** Failing test first, then the code, then the test passes. If the code came first, `git stash push -u -- <implementation files>`, watch the test fail, then `git stash pop`.
- **Rules.** AGENTS.md §5 (layers, caps, errors) and §1 working rules (glossary names, locale-only copy). Comments in English on every new feature, exported function and complex line; say why, not what.
- **Commits.** Small Conventional Commits (AGENTS.md §6), each referencing `#<N>`.
- **Docs in the same change.** `docs/spec/**` and the status header of `docs/spec/requirements/<domain>.md`. New registry entries take a `{{KEY:slug}}` placeholder, never a number; KEY is `ENG` in `docs/SSOT/DECISIONS.md` and `D` in `docs/spec/90_decisions_log.md` (AGENTS.md §4 lists all four). Tech debt becomes a `tech-debt` issue.

## Phase 6: Findings outside the scope

A bug, suspicious behavior, flaky test, dead code, or a doc that contradicts the code: **do not fix it inline.** Follow [`references/findings.md`](references/findings.md) to de-duplicate and open or extend one issue, which waits for the PM (`needs-triage`). **Never describe a security finding in public text.**

## Phase 7: Verify locally

```bash
set -o pipefail; cd app && pnpm typecheck 2>&1 | tail -n 40 && pnpm test 2>&1 | tail -n 80 && pnpm lint 2>&1 | tail -n 40
```

Run every other level the testing matrix requires, or name it as CI-only when Phase 0 found no local stack or emulator. Never push red. Never skip, weaken or `.skip` a test.

## Phase 8: Open the PR

```bash
git push -u origin HEAD
gh api -X POST $R/pulls -f base=dev -f head="$(git branch --show-current)" -f title="<type>(<scope>): <subject>" -F body=@<file> --jq .number
gh api -X POST $R/issues/<PR>/labels -f 'labels[]=agent:<you>' --jq 'map(.name)'
```

- **Body.** Fill every section of `.github/PULL_REQUEST_TEMPLATE.md`:
  - **Opened by:** `Opened by: agent:<you>`; leave the CLA box unticked (it is a person's statement).
  - **Summary:** `Closes #<N>`, or `Refs #<N>` when work stays open.
  - **Mapped to spec**, as the template asks.
  - **Tests:** the levels run, and those left to CI.
  - **Risk / rollout notes:** `Verification: #V` (or none) and `Findings opened: #a` (or none).
- **Ready, not draft.** Auto-merge is armed for you (`auto-merge-agent-ready.yml`).
- **Write the body once.** Editing a PR body re-runs CI and cancels the run in flight.

## Phase 9: Drive to merge, then close out

Follow [`references/ci-and-merge.md`](references/ci-and-merge.md): watching, red CI, conflicts and dequeues, and the close-out after the merge.

## Final report (one block, then stop or continue the loop)

```
#<N> <title> → PR <url> merged into dev (<sha>)
Spec: <section / D# / G#>  ·  Tests: <levels added; CI-only levels>  ·  Gates: green
Filled in: <what, or none>  ·  Verification issue: <#V or none>
Findings: #a, #b (or none)  ·  Follow-ups / risks: <one line or none>
```

A blocked run reports instead: the issue, the exact question, your recommended answer, and the next issue taken (if any).
