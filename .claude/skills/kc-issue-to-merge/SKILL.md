---
name: kc-issue-to-merge
description: Take one GitHub issue of KarmaCummunity/KC from claim to a squash-merge into dev - pick or receive the issue, check it is not taken or duplicated, claim it, sharpen and label it, implement it test-first with tests at every level the change touches, open findings outside the scope as triage issues, open the PR, and drive it through CI and the merge queue. Use when asked to "take an issue", "work the next task", "solve #N end to end", or run the agent task loop. Agent-agnostic - Claude Code, Cursor, Codex, Antigravity and the KC bot follow the same steps with git and gh.
---

# KC issue to merge

One run = one issue = one PR to `dev`, driven until it merges. Then report and stop.

`AGENTS.md` holds the repo rules (spec gate, architecture, prohibitions) and wins on any conflict.
This skill is the order of work. It cites those rules, not repeats them.

**Conventions used below:**
- **`<you>`** is your agent label suffix: `claude`, `cursor`, `codex`, `antigravity` or `kc-bot`.
- **`R=repos/KarmaCummunity/KC`** is the REST prefix.
- **REST only.** Every GitHub call is `gh api` (REST), so it also works where GraphQL is blocked. If your runtime gives you GitHub tools instead of `gh`, do the same operation with them.

## Token rules (apply in every phase)

1. **Find, then read.** `rg`/glob for the symbol, then read the matching line range. Never read a whole large file, a lockfile, generated types or a migration you do not change.
2. **Spec by section, from `dev`.** Read through `node scripts/spec.mjs <domain|FR-ID>` (it reads `dev`, not your stale tree). Open `docs/spec/README.md` only for the index, then the one cited section. Never the whole book.
3. **Narrow output.** Every `gh api` call ends in a `--jq` that keeps only the fields you need. Never dump an issue's full timeline.
4. **Tail long output.** Pipe test and build output through `tail -n 80` or `grep -E "FAIL|Error|✗"`. For CI use `gh run view <id> --log-failed | tail -n 150`.
5. **Targeted before full.** Run the tests for the package or file you touched while iterating; run the full gates once, before the push.
6. **Read once.** Do not re-read a file you just edited, or a doc already summarized in this run.
7. **Delegate sweeps.** If your runtime has subagents, send broad searches (many files or naming variants) to one and keep only its conclusion.
8. **Lazy references.** Open a file under `references/` only when its phase starts.
9. **Stop early.** A blocked task stops exploring at once (Phase 3, "Product questions").

## Phase 1: Pick and de-duplicate

- **Given an issue number:** take it.
- **Otherwise:** take the oldest issue at the highest priority (`priority:launch` > `P0` > … > `P3`, AGENTS.md §13). Two kinds of issue are not in the queue:
  - **Untriaged:** an issue without a `priority:*` label.
  - **Reserved for a person:** `human`, `maintainer-only` or an `owner:*` label (store consoles, credentials, releases).

  The project board's Agent queue mirrors these labels; reading the board needs a token with project scope, labels do not.

  ```bash
  for p in launch P0 P1 P2 P3; do
    out=$(gh api -X GET search/issues -f sort=created -f order=asc -f per_page=5 --jq '.items[] | "#\(.number) \(.title)"' \
      -f q="repo:KarmaCummunity/KC is:issue is:open label:priority:$p -label:in-progress -label:blocked -label:needs-triage -label:ops-alert -label:epic -label:human -label:maintainer-only -label:owner:nave")
    if [ -n "$out" ]; then echo "priority:$p"; echo "$out"; break; fi
  done
  ```

Before claiming, the issue must pass three checks. Any failure: skip it and take the next row.

1. **Not claimed.** It has no `in-progress` label, or the claim is stale ([ISSUE_CLAIMS](../../../docs/agents/ISSUE_CLAIMS.md)).
2. **No open PR.**

   ```bash
   gh api -X GET search/issues -f q="repo:KarmaCummunity/KC is:pr is:open <N> in:body" --jq '.items[] | "#\(.number) \(.title)"'
   ```

3. **Not a duplicate.** Search 2-3 distinctive keywords from the title, in issues and in merged PRs:

   ```bash
   gh api -X GET search/issues -f per_page=8 -f q="repo:KarmaCummunity/KC is:issue <keywords> in:title,body" --jq '.items[] | "#\(.number) [\(.state)] \(.title)"'
   gh api -X GET search/issues -f per_page=5 -f q="repo:KarmaCummunity/KC is:pr is:merged <keywords>" --jq '.items[] | "#\(.number) \(.title)"'
   ```

   - **Already done by a merged PR:** comment with the link, add `possible-duplicate`, and skip. Only the PM closes it.
   - **Overlaps an open issue:** comment on both, add `possible-duplicate`, and skip.

## Phase 2: Claim

```bash
gh api -X POST $R/issues/<N>/labels -f 'labels[]=in-progress' -f 'labels[]=agent:<you>' --jq 'map(.name)'
gh api -X POST $R/issues/<N>/comments -f body="claimed by agent:<you>" --jq .html_url
gh api $R/issues/<N>/comments --jq '[.[] | select(.body | startswith("claimed by")) | {a:.user.login, b:.body, t:.created_at}] | .[-3:]'
```

- **Race.** If another claim landed at the same time, the earlier comment wins. The loser removes its labels (`gh api -X DELETE $R/issues/<N>/labels/<label>`), comments `released: lost claim race`, and returns to Phase 1.
- **Board.** If your token can write the project, set Status = In progress. Otherwise the labels carry the state.
- **Stale sweep.** A claim with no open PR for 6 hours is swept. On long work, open the PR as soon as the first green commit exists (Phase 8), then keep pushing to it.

## Phase 3: Define the task

Read [`references/define-and-label.md`](references/define-and-label.md).

1. **Read** the issue (`gh api $R/issues/<N> --jq '{title, body, labels: [.labels[].name]}'`), its spec ref and the cited spec section (`node scripts/spec.mjs <domain|FR-ID>`). Run `node scripts/spec.mjs --changed` once: if a file you rely on moved on `dev`, merge `origin/dev` first.
2. **Run the spec validation gate** (AGENTS.md §2) and sort every gap into one of two classes:
   - **Technical gap: fill it.** Missing acceptance criteria derivable from the spec, a test plan, likely files, missing labels. Add a `### Filled in by agent:<you>` section to the issue body, so the PM sees what was added.
   - **Product question: stop.** The task contradicts the spec, the spec is silent on behavior a user will see, or two reasonable readings give users different behavior.
     - **The PM is in your conversation:** ask now, in Hebrew, in the AGENTS.md §2 format, with options and a recommendation. Continue on the answer, and write it into the spec (AGENTS.md working rule 7).
     - **Nobody to ask (autonomous run):** follow "Blocked" in the reference, then return to Phase 1 for another issue.
3. **Label** the issue to the taxonomy in the reference: one type, at least one `area:*`, one `priority:*` and one `size:*`.

## Phase 4: Plan and test matrix

Read [`references/testing-matrix.md`](references/testing-matrix.md).

1. **Plan.** List the files you will change and the test levels the change requires. A bug always starts with a regression test that fails before the fix.
2. **Branch** from fresh `dev`:

   ```bash
   git fetch origin dev && git switch -c <type>/<N>-<area>-<slug> origin/dev
   ```

   If your runtime assigns a branch name, use that name, still based on `origin/dev`. If that branch already carried a PR that merged, recreate it from `origin/dev` (`git checkout -B <branch> origin/dev`); never stack new work on merged history.
3. **Migrations.** Writing SQL? Claim a migration range first ([MIGRATION_RANGES](../../../docs/agents/MIGRATION_RANGES.md)).

## Phase 5: Implement test-first

- **Order.** Write the failing test, watch it fail for the right reason, implement, watch it pass. If the code came first, prove the test anyway: `git stash push <implementation files>`, run the test and see it fail, then `git stash pop`.
- **Layers.** Keep the Clean Architecture invariants and the hard caps (AGENTS.md §5): files ≤ 300 lines, nesting ≤ 3 levels, typed domain errors, no speculative abstractions.
- **Names.** Use product language from `docs/spec/94_glossary_and_naming.md`. Never a bare `categories`.
- **Copy.** User-visible strings go in the locale files, never inline.
- **Comments.** Add English comments on every new feature, exported function and complex line. Say why, not what.
- **Commits.** Small atomic Conventional Commits (AGENTS.md §6), each referencing `#<N>`.
- **Docs.** Update the spec in the same change (AGENTS.md §4): `docs/spec/**` and the status header of `docs/spec/requirements/<domain>.md`. Decisions go to `docs/SSOT/DECISIONS.md`. New registry entries use `{{KEY:slug}}` placeholders, never a number. Tech debt is a `tech-debt` issue, never a doc row.

## Phase 6: Findings outside the scope

Something outside the issue that deserves work: a bug, a suspicious behavior, a flaky test, dead code, a doc that contradicts the code, tech debt. **Do not fix it inline.** Read [`references/findings.md`](references/findings.md), de-duplicate, and open or extend one well-defined issue. It waits for the PM's triage (`needs-triage`).

**Security findings are never described in public text.** See the reference.

## Phase 7: Verify locally

From `app/`:

```bash
pnpm typecheck 2>&1 | tail -n 40
pnpm test 2>&1 | tail -n 80
pnpm lint 2>&1 | tail -n 40
```

Run every other level from the matrix that the change touches. Never push red. Never skip, weaken or `.skip` a test to get green; the test-integrity judge in CI rejects it anyway.

## Phase 8: Open the PR

```bash
git push -u origin HEAD
gh api -X POST $R/pulls -f base=dev -f head="$(git branch --show-current)" \
  -f title="<type>(<scope>): <subject>" -F body=@<body-file> --jq '.number'
gh api -X POST $R/issues/<PR>/labels -f 'labels[]=agent:<you>' --jq 'map(.name)'
```

- **Body.** Fill every section of `.github/PULL_REQUEST_TEMPLATE.md`:
  - `Opened by: agent:<you>`.
  - `Closes #<N>`, or `Refs #<N>` if the PR does not finish the issue.
  - `Mapped to spec` with the section, D# or G#.
  - The test levels run and their results.
  - `Findings opened: #a, #b` (or `none`).
- **Ready, not draft.** Open the PR ready, unless the PM asked for a draft. `auto-merge-agent-ready.yml` arms squash auto-merge on every ready PR into `dev`. Confirm with `gh api $R/pulls/<PR> --jq .auto_merge` a few minutes later. If it is still `null`, arm it with `gh pr merge <PR> --auto --squash` or your runtime's tool.
- **Board.** If writable, set Status = In review.

## Phase 9: Drive to merge, then close out

- **Watching.** Claude Code: subscribe to the PR's activity and follow `.claude/skills/babysit/SKILL.md`. Other agents: wait on `CI gate`, with a pause of minutes between checks, never a tight loop:

  ```bash
  gh api "$R/commits/$(git rev-parse HEAD)/check-runs?per_page=100" --jq '.check_runs[] | select(.name=="CI gate") | "\(.status) \(.conclusion)"'
  ```

- **Red `CI gate`.** Read only the failed lane's log, reproduce it locally, fix the cause and push. Up to 3 attempts per cause. After that, repair CI itself if CI is what's broken (AGENTS.md §13, step 7). After 2 more failures, take the blocker path.
- **Conflict or dequeue.** Merge `origin/dev` into the branch (a merge commit; never rebase a pushed branch, since that needs a force push). Resolve each conflict so both sides' behavior survives, and add a test where the two meet. Re-run the gates, push, and re-arm auto-merge: a dequeue disarms it.
- **Human review.** Answer or fix every review comment.
- **Merged** (`gh api $R/pulls/<PR> --jq .merged`):
  1. **The PR said `Closes #<N>`:** confirm the issue closed and the claim labels are gone. `close-issues-on-dev-merge.yml` and `issue-claims.yml` do this; if they did not, do it yourself.
  2. **The PR said `Refs #<N>`:** the workflows leave the issue open and claimed. Remove `in-progress` and `agent:<you>` yourself, and comment what shipped plus a checklist of what still blocks closing.
  3. Delete the local branch, or reset it to `origin/dev`, and report.

## Final report (one block, then stop)

```
#<N> <title> → PR <url> merged into dev (<sha>)
Spec: <section / D# / G#>  ·  Tests: <levels added>  ·  Gates: green
Filled in on the issue: <what, or none>
Findings: #a <title>, #b <title> (or none)
Follow-ups / risks: <one line or none>
```

A blocked run reports instead: the issue, the exact question, your recommended answer, and the issue taken next (if any).
