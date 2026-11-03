# Setup — Let the Agent Manage Git & GitHub

One-time setup so the agent (Claude Code / Cursor) can branch, commit, push, open PRs, and auto-merge **for you**, professionally and safely.

You do steps 1–5 once on your machine. After that, the agent follows `.cursor/rules/git-workflow.mdc` automatically on every code change.

> The repo is `KarmaCummunity/KC`. Default branch: `main`. Merge style: **squash**. Auto-merge: **on, after CI passes**.

---

## 1. Install GitHub CLI (`gh`)

```bash
brew install gh
gh --version    # confirm install
```

If you don't use Homebrew, see https://cli.github.com/.

## 2. Authenticate `gh`

```bash
gh auth login
# Choose: GitHub.com → HTTPS → Login with a web browser → Authorize
gh auth status      # must show "Logged in to github.com"
gh auth setup-git   # makes git use gh's credentials, no PATs needed
```

## 3. Configure git identity (once per machine)

```bash
git config --global user.name  "Your Name"
git config --global user.email "you@example.com"

# Optional but useful:
git config --global pull.rebase true            # cleaner pulls
git config --global push.autoSetupRemote true   # `git push` works on new branches
git config --global rebase.autoStash true
```

## 4. Configure the repo defaults

Run from the root of your local clone of this repo:

```bash
# Tell gh which repo this clone points to.
gh repo set-default KarmaCummunity/KC

# Set squash as the only allowed merge method (matches our workflow).
gh repo edit KarmaCummunity/KC \
  --enable-squash-merge \
  --enable-auto-merge \
  --delete-branch-on-merge \
  --enable-merge-commit=false \
  --enable-rebase-merge=false
```

## 5. Add branch protection on `main` (recommended)

This is what makes the auto-merge gate meaningful — `main` will only accept commits via PR with green CI.

Easiest path is the GitHub UI:

1. Open https://github.com/KarmaCummunity/KC/settings/branches
2. **Add rule** → branch name pattern: `main`
3. Enable:
   - **Require a pull request before merging** (Approvals: 0 — you're the only reviewer for now).
   - **Require status checks to pass** → after the first CI run, search for and select:
     - `quality · typecheck · test · lint` (from our `ci.yml`)
     - `pr-hygiene · PR hygiene`
   - **Require branches to be up to date before merging** ✅
   - **Do not allow bypassing the above settings** — leave **off** for yourself for now (so you can hot-fix typos), per the workflow rule's `hotfix-trivial` clause.
4. Save.

> To do this from CLI instead: see https://cli.github.com/manual/gh_api and the `repos/{owner}/{repo}/branches/{branch}/protection` endpoint. The UI is faster for the first time.

## 5b. Add branch protection on `dev` (required for working branch)

All feature PRs target `dev`. After the first CI run on a PR to `dev`, configure:

1. Open https://github.com/KarmaCummunity/KC/settings/branches
2. **Add rule** → branch name pattern: `dev`
3. Enable:
   - **Require a pull request before merging** (0 approvals).
   - **Block force pushes** and **Do not allow deletions**.
   - **Require status checks to pass** — select checks from the table in `docs/SSOT/ENVIRONMENTS.md` § Dev merge gates, including:
     - `migration destructive-op scan` (CI — dev guard)
     - `typecheck · test · lint`, `PR hygiene`, and the other jobs listed there.
   - Do **not** require **CI — main release guard** (prod-only).
4. Save.

## 6. (Optional) Pre-commit secret scan

Stops you from accidentally committing tokens / `.env` files:

```bash
brew install gitleaks
cd /path/to/your/clone/of/GloWe
gitleaks protect --staged --redact   # run before each push (CI can run this too later)
```

## 7. Sanity check — does the agent's pre-flight pass?

```bash
gh --version
gh auth status
git config user.name
git config user.email
gh repo view --json nameWithOwner -q .nameWithOwner    # → KarmaCummunity/KC
( cd app && pnpm install && pnpm typecheck && pnpm test && pnpm lint )
```

If all five succeed, the agent has everything it needs.

---

## What the agent will do from here on

For any non-trivial change, the agent runs (per `.cursor/rules/git-workflow.mdc`):

1. `git switch main && git pull --ff-only`
2. `git switch -c <type>/<FR-id>-<slug>`
3. Make focused commits in Conventional Commits style.
4. Run `pnpm typecheck && pnpm test && pnpm lint` from `app/`.
5. `git push -u origin HEAD`
6. `gh pr create` with the PR template (filled in, includes `Mapped to SRS`).
7. `gh pr merge --auto --squash --delete-branch` — GitHub squash-merges as soon as CI is green.
8. Sync `main` locally and delete the branch.

For a true typo (docs/comments only), the agent may push directly to `main`. Anything else → PR.

---

## Troubleshooting

| Problem | Fix |
| ------- | --- |
| `gh auth status` says "not logged in" | Re-run `gh auth login`. |
| `gh pr merge --auto` returns "auto merge is not allowed for this repository" | Step 4 above (`gh repo edit … --enable-auto-merge`). |
| CI red on a PR | Push a fix-up commit on the branch — auto-merge will fire when it goes green. Don't bypass. |
| Push rejected on `main` after enabling protection | That's working as intended — open a PR via §5 of the workflow rule. |
| Agent pushed without running gates | Add the gate to a local pre-push hook (`.git/hooks/pre-push`) or trust CI to catch it — CI is the backstop. |
| `git status` complains about a stale lock file | Remove it: `rm .git/index.lock` (only when no other git command is running). |
| Stale worktree pointer under `.git/worktrees/` | Prune with `git worktree prune`. |

That's it. Once §1–§5 are done you don't have to touch this again.
