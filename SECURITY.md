# Security Policy

## Reporting a vulnerability

Please **do not** open a public GitHub issue for unpatched vulnerabilities.

1. Prefer GitHub **Private vulnerability reporting** on this repository.
2. Fallback: email `karmacommunity2.0@gmail.com` with steps to reproduce.

We will acknowledge receipt and coordinate a fix before any public disclosure.

## Quality & security tooling (contributor matrix)

External contributors do **not** need accounts on these tools. They run as
GitHub/org integrations on every PR.

| # | Tool | Status | Blocks merge? | Notes |
| - | ---- | ------ | ------------- | ----- |
| 1 | **SonarCloud** (SonarQube SaaS) | ✅ Active | **Yes** (inside `CI gate`, `frontend` lane) | Workflow: `.github/workflows/ci-sonar.yml`. Setup: `docs/dev/SONAR.md`. |
| 2 | **Snyk** | ✅ Active (`SNYK_TOKEN` set) | No (promote later) | Workflow: `.github/workflows/ci-snyk.yml`. |
| 3 | **CodeRabbit** | ✅ Active (org App installed) | No (review comments only) | `.coderabbit.yaml` reviews `app/**`, `supabase/**`, `scripts/**` and `docs/spec/**`. |
| 4 | **GitHub Dependabot** | ✅ Active | N/A (opens fix PRs) | Config: `.github/dependabot.yml`. Security updates: **enabled**. |
| 5 | **GitGuardian** (ggshield) | ✅ Active (`GITGUARDIAN_API_KEY` set) | No (promote later) | Workflow: `.github/workflows/ci-gitguardian.yml`. |
| 6 | **Secret Scanning** | ✅ Active | Push-time block | Enabled + push protection on the public repo. |
| 7 | **Dependency audit** | ✅ Active | **Yes** (`CI gate`, `static` lane, when a dependency file changes) | `scripts/check-dependency-audit.mjs`: every lockfile + Edge Function npm imports; daily on `dev` and `main` via `.github/workflows/dependency-audit.yml`. See "Dependency audit" below. |
| 8 | **Automated tests** | ✅ Active | **Yes** (`CI gate`) | Unit: Vitest in the `frontend` lane. Integration: the `backend` lane (migrations, RLS, types, SQL probes) and the RPC contract check in the `static` lane. E2E on `main` release: the `release` lane's P0 journeys. |

Contributors should run locally before opening a PR (from `app/`):

```bash
pnpm typecheck && pnpm test && pnpm lint
```

## Maintainer setup

Repository security features (verified 2026-07-19 via `gh api` read-back):

| Feature | Status |
| --- | --- |
| Private vulnerability reporting | enabled |
| Dependabot security updates | enabled |
| Dependabot version updates | enabled (`.github/dependabot.yml` → weekly npm + monthly Actions on `dev`) |
| Dependency audit exceptions | each expires at most 90 days after its review; the scheduled audit opens an issue when one expires (#1373) |
| Secret scanning | enabled (org/repo policy; do not disable) |
| Secret scanning push protection | enabled (do not disable) |
| Fork PR workflow approval | `first_time_contributors` |
| GitHub Discussions | enabled |

### One-time secrets (org-admin / maintainer)

Add these under **GitHub → Settings → Secrets and variables → Actions** (repo or org):

| Secret | Tool | How to obtain |
| --- | --- | --- |
| `SONAR_TOKEN` | SonarCloud | ✅ Already set. SonarCloud → My Account → Security → token. |
| `SNYK_TOKEN` | Snyk | [snyk.io](https://app.snyk.io/account) → Auth token → org service account recommended. |
| `GITGUARDIAN_API_KEY` | GitGuardian | [GitGuardian dashboard](https://dashboard.gitguardian.com/) → API → service account or personal token. Alternative: install the [GitGuardian GitHub App](https://github.com/apps/gitguardian) instead of CI. |

### CodeRabbit (GitHub App — no secret in repo)

1. Org admin installs [CodeRabbit](https://github.com/apps/coderabbitai) on `KarmaCummunity/KC`.
2. `.coderabbit.yaml` is already committed — reviews cover the KC app, backend and scripts.
3. Open a test PR; verify CodeRabbit posts review comments (non-merging).

### Promoting Snyk / GitGuardian to required checks

After 1–2 weeks of clean baselines:

1. Remove `continue-on-error: true` from the workflow job (or flip to hard-fail).
2. Add `Snyk dependency scan` / `GitGuardian secret scan` to branch protection on `dev`/`main`.
3. Update `docs/SSOT/ENVIRONMENTS.md` "Dev merge gates" table in the same PR.

## Dependency audit

`scripts/check-dependency-audit.mjs` is the single authoritative check for known advisories
in npm dependencies (#1373). It reads every committed lockfile (`app/pnpm-lock.yaml`,
`scripts/package-lock.json`, `tests/e2e/package-lock.json`, and any lockfile added later)
plus the exact-version `esm.sh` / `npm:` imports of the Edge Functions, and asks the npm
registry's bulk advisory endpoint (the one `npm audit` uses) which advisories affect them.

- **Blocking:** a `high` or `critical` advisory fails unless a reviewed, unexpired exception
  covers that advisory in that package. `moderate` and `low` are listed in the log only.
- **When it runs:** in the `static` lane of `CI gate` whenever a diff touches a lockfile, a
  `package.json`, an Edge Function source or the audit itself; daily on `dev` and `main`
  (`dependency-audit.yml`), which keeps one tracking issue open while it fails. A diff without
  dependency changes skips it, so a newly published advisory never blocks unrelated PRs
  (`TD-254`). A registry outage fails the audit: an audit that did not run never passes.
- **Exceptions** live in `scripts/check-dependency-audit.allowlist.json` (code-owned, so each
  one needs the owner's review). Every entry names one advisory and one package and carries
  a `reason` (why it cannot be fixed now and why the exposure is acceptable), the `reviewed`
  date and an `expires` date at most 90 days later. An expired exception stops excusing its
  finding; an exception no finding needs any more is reported for removal.
- **Fix first:** upgrade the dependency or add a scoped `pnpm.overrides` entry in
  `app/package.json`; add an exception only when no compatible fix exists. Findings about a
  specific package are discussed with the owner privately, never in public issues.
- **Not covered:** dependencies that the Edge Functions' esm.sh imports pull in (no Deno
  lockfile) and imports pinned to a range (reported as not auditable) — tracked in
  the `tech-debt` issues.
