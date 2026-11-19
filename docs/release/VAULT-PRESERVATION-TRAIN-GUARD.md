# KC #2509 release-train preservation gate

This patch is preparation only. It does not authorize a release, production
approval, workflow dispatch, main merge, or suspension of the weekly train.

## Contract

`release-preservation.mjs` pins the SHA-256 bytes of seven reviewed files from
#2510, commit `449c15966e42ddd5c3e35d4a0e993e8b6e02d5af`. They cover the caller
workflow, reusable DB/functions/preflight workflows, manual seed workflow,
retrieval/probe/preservation script, and deploy preflight. A marker alone is
insufficient. An intentional edit to any contract file requires review and an
explicit contract update. This is deliberately conservative, including for
comment-only edits.

Both `GITHUB_WORKFLOW_SHA` (the train's caller snapshot) and the target tree must
match. The gate also checks deploy/seed workflows and scripts and seed SQL/shell
files for direct Vault writes. This scan is defense in depth, not a proof about
arbitrary obfuscated code or every possible future executable.

Main/dev API SHAs are pinned before compare/migration scans. The gate fetches
immutable objects and repeats ref and contract checks before freeze, opening
the release PR, release merge, on entry to deploy, and immediately before
production approval. Missing refs/blobs, retrieval failures and drift stop the
next action. The production run must also be a main workflow_run at the exact
merge SHA. Existing backup, CI, migration, release and deploy gates remain.

A newly Draft PR retains the train-added hold and is never re-armed by unfreeze.
Pre-existing or newly manual no-auto-merge labels also prevent re-arming.
Cleanup requires the exact latest labeling event ID and actor to match the
train-created event; missing historical ownership evidence keeps the hold. This patch does not
alter unrelated PRs or their present holds during development.

## Deployment order and limits

A dev-only patch cannot protect Sunday's main snapshot. The release train files
were byte-identical on main `f6c36c4a6e7ff1bbdb171006921e2a4b10d2c879` and dev
`0646147d66825ac3bd8f29acac90c3cadef097fc` when this patch was prepared, so this
guard can be reviewed as the same isolated backport candidate without bringing
#2510 or other dev work into main.

Once only the guard is on main, the train WILL stop until caller and target both
contain the reviewed preservation implementation. That temporary hold is an
operational effect and needs the owner's focused approval. It is not bypassed
just because target dev is fixed. A normal run already started from the old
main snapshot is not retroactively protected. Old-SHA reruns and manual seed
workflows also remain outside this train gate.

Proposed review order, not execution authority:

1. Obtain approval for the isolated main guard and its temporary hold effect.
   Recheck current main/dev refs and all running/queued release/deploy runs.
2. Bring the reviewed guard to main through an explicitly approved safe path.
   Do not assume dev promotion will protect the caller that performs it.
3. Verify #2510 through normal CI and dev acceptance. Promote the reviewed
   preservation changes to main through a separately approved path, without
   importing unrelated dev work. Do not use a train bypass to bootstrap this.
4. Before resuming normal operation, run read-only validation of immutable
   caller/target objects and all ordinary gates. A safe/safe contract permits
   only the ordinary gates, never a release by itself.

The alternative temporary stop-step patch is intentionally more blunt: it exits
before Plan and before train operator/approver tokens are attached to steps.
It is an option for review, not applied state, and likewise needs approval.

## Evidence

`node --test scripts/release-preservation.test.mjs scripts/release-train.test.mjs`
runs executable train steps against a temporary Git repository and local mock
GitHub API. It covers unsafe caller/target combinations, safe/safe progression
to ordinary gates, changed code despite markers, additional seed writes,
missing objects, API failure, ref drift before merge and after production-run
waiting, and newly Draft unfreeze. Fixtures contain only source code, no secrets.
No live release, main write, production operation or workflow dispatch is part
of these tests.
