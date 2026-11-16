# Weekly release train

Once a week, dev goes to main, then production, then TestFlight and Play internal. No human clicks anything. The owner decided this on 16 Nov 2026: "everything automatic, I don't want to approve".

If a gate fails, the train **stops and reports**. It never waits for an approval. A release that the train refuses can still go out by hand with the manual procedure (`scripts/release-merge.mjs` and the Deploy approval).

| | |
|---|---|
| Workflow | `.github/workflows/release-train.yml` |
| Logic | `scripts/release-train.mjs`; rules in `scripts/release-train-lib.mjs`, tests in `scripts/release-train.test.mjs` |
| Schedule | Sunday 04:00 UTC: 06:00 Israel in winter, 07:00 in summer |
| Kill switch | repo variable `KC_WEEKLY_RELEASE_ENABLED`. The train acts only when it is exactly `true` |
| Status for bots | artifact `release-train-status` (JSON, kept 90 days) on the run, plus the job summary |
| Store review | repo variable `KC_STORE_AUTO_SUBMIT_REVIEW` (default `false`). This is a stub only: nothing submits for review |

The schedule and real runs use **main's** copy of the workflow, because main is the default branch. A change to the train takes effect only after a release carries it. To test a change on dev first, dispatch a dry run from dev:

```sh
gh workflow run release-train.yml --ref dev -f dry_run=true
```

## What one run does

1. **Plan.** These checks are read-only. A dry run stops after them.
   - **Kill switch.** It must be `true`. Dry runs ignore it.
   - **Ref.** A real run must use main's copy.
   - **Anything to release?** The train skips the week when `main...dev` has no file change other than `app/VERSION`.
   - **No release in flight.** An open dev → main PR means a manual release is under way.
   - **Strict migration scan of `main...dev`.** This is stricter than the CI release lane, and it ignores `migration-safety: allow`. It stops on:
     - `DROP TABLE/SCHEMA/TYPE/DATABASE`;
     - `ALTER TABLE … DROP [COLUMN]`;
     - `ALTER COLUMN … TYPE`;
     - `ALTER TABLE/SCHEMA/TYPE … RENAME`;
     - `TRUNCATE`;
     - `DELETE` or `UPDATE` without `WHERE`;
     - any edited, deleted or renamed existing migration.

     Comments, strings and `$$` function bodies are not scanned.
   - **Fresh prod backup.** A green `db-backup-prod.yml` run on main must be at most 30 h old. That workflow runs nightly at 01:17 UTC and includes a restore check.
   - **Release head.** If dev's tip is a `[skip ci]` version bump, a version-only PR is needed: a release PR on that tip would get no PR CI.
   - **Credentials.** The train checks that both tokens exist, that the approver is a required reviewer of `production`, and that the operator is a repo admin with Administration access.
   - **Freeze preview.**
2. **Freeze dev.** Every open PR into dev with auto-merge armed or a merge-queue slot is dequeued, has auto-merge turned off, and gets the `no-auto-merge` label. PRs armed later in the run (dependabot, for example) are frozen as soon as they appear.
3. **Release head.** If needed, the train opens `chore(release): set app version X.Y.Z+1 …` into dev through the merge queue. A merge that edits `app/VERSION` gets no bump, so its merge commit becomes dev's tip and has real CI.
4. **Release PR.** The train opens `chore(release): promote dev to main (vX.Y.Z)` as the operator, labelled `area:ci` and `agent:kc-bot`. Its title and body are never edited afterwards, because an edit re-runs the gate.
5. **Wait.** CI gate, CI verdict, `release / dev E2E on the release head` and every other check and status on the head must be green, and the PR must be `clean`.
   - Failed jobs are re-run **once** automatically. kc-dev flakes are common.
   - A second failure stops the train.
   - If dev moves, the train stops.
   - The limit is 4 h.
6. **Merge.** The train squash-merges with the `release-merge.mjs` message, which contains no skip tokens. `delete_branch_on_merge` is turned off for that one call; the `dev: never deleted` ruleset also protects dev. If dev disappeared anyway, the train recreates it and stops.
7. **Deploy.** Main's push CI starts Deploy (main). The train checks again that main is still the release commit and the backup is still fresh, then approves `production` with the approver token. That is the one click the owner used to make. Then it requires each of these to be green:
   - backup (prod);
   - migrations · prod;
   - functions · prod;
   - web · prod;
   - smoke · prod;
   - tag release.

   It also checks that tag `vX.Y.Z` points at the merge commit and that `/version.json` on prod serves it. When the release changed migrations, the run must also hold the encrypted `prod-db-backup-<sha>` artifact.
8. **Sync.** `sync-main-to-dev.yml` opens the ancestry PR. The train checks that it changes zero files and merges main's commit, then merges it as a merge commit. `allow_merge_commit` is on for that one call only, and the operator's admin role bypasses the squash-only queue.
9. **Lift the freeze.** This always runs. Labels the train added are removed and auto-merge is re-armed, as the operator so the queue's merges still trigger CI.
10. **Stores.** `prod-store-build.yml` starts by itself after the tagged Deploy. The train waits up to 100 min and reports each lane. Builds go to TestFlight and Play internal only; nothing is submitted for review or published.
11. **Report.** This always runs. It writes the job summary and the status artifact. If the repo variable `KC_RELEASE_TRAIN_ISSUE` holds an issue number, it also comments there.

A red run means the train stopped. GitHub's failed-run notification and the summary say where and why.

## Rollback

There is nothing new here. `deploy.yml` already rolls back by itself (`deploy-rollback.yml`) when functions, web or smoke fail after the approval:
- web goes back to the Cloudflare deployment recorded just before;
- functions go back to the previous `v*` tag;
- smoke runs again;
- the run stays red and no tag is created.

If the release **applied migrations**, there is no automatic code rollback. The old code may not work against the new schema, so the fix is a forward-fix. The database is never rolled back automatically. The pre-migration encrypted dump on the Deploy run is there for a manual restore. The train reports the rollback jobs' results.

## Credentials

Both secrets live **only** on the GitHub environment `release-train`:
- its deployment branches are `main` and `dev`;
- it has no reviewers;
- only jobs that name that environment can read them.

`release-train.yml` is the only workflow that does. The workflow test fails if a job that uses secrets does not name the environment. The tokens are never printed; they go only into request headers.

| Secret | What it is | Used for |
|---|---|---|
| `KC_RELEASE_TRAIN_APPROVER_TOKEN` | Fine-grained PAT of `karma-community-kc`, a required reviewer of `production`. Same token as `~/.kcsec/kc-prod-approver.pat` (Deployments RW, Actions R; expires 2027-11-12) | one call per release: approving the Deploy run |
| `KC_RELEASE_TRAIN_TOKEN` | **Operator.** Fine-grained PAT of `karma-community-kc` (repo admin), limited to KarmaCummunity/KC, with **Administration, Contents, Pull requests, Actions: read and write** | creating the version branch and commit, opening PRs, auto-merge, the release merge, the sync merge, the two setting toggles, re-running failed jobs |

Why not `GITHUB_TOKEN`:
- It cannot open PRs; that repo setting is off on purpose.
- Merges and auto-merge done with it start no workflows, so main would get no CI and no Deploy.
- It cannot change repo settings.

Why not the owner's classic PAT: it has org-wide admin scope, which is far more than the train needs.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `KC_WEEKLY_RELEASE_ENABLED` | unset (off) | `true` = the schedule releases |
| `KC_STORE_AUTO_SUBMIT_REVIEW` | `false` | Stub. Store review submission is **not implemented**; when `true` the train only notes it |
| `KC_RELEASE_TRAIN_ISSUE` | unset | issue number for a status comment per run |

Time limits are set in the script and can be overridden through the step env: `KC_RELEASE_TRAIN_CHECKS_MINUTES` (240), `KC_RELEASE_TRAIN_VERSION_PR_MINUTES` (120), `KC_RELEASE_TRAIN_DEPLOY_MINUTES` (120), `KC_RELEASE_TRAIN_BACKUP_MAX_AGE_HOURS` (30), `KC_RELEASE_TRAIN_RETRIES` (1).

## When the train stops

| Where | Typical cause | What to do |
|---|---|---|
| plan / migration safety | destructive or edited migration | release by hand after reviewing it, or make the migration additive |
| plan / prod backup | the nightly backup failed | fix `db-backup-prod`; the next run (or a dispatch) goes again |
| checks | a red lane twice; **the release changes `ci.yml` lanes or deletes tests** (CI gate then needs an owner approval on the head; the train never approves PRs) | fix forward on dev, or release by hand with the owner's review |
| checks | dev moved despite the freeze | nothing; next week, or dispatch again |
| deploy | stage failure (rolled back automatically unless migrations ran) | read the Deploy run; forward-fix |
| sync / lift freeze | API error | merge the sync PR / re-arm the listed PRs by hand |

Dispatch a real run outside the schedule (only from main, and only with the kill switch on): `gh workflow run release-train.yml --ref main -f dry_run=false`.
