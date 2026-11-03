# SonarCloud + Cursor + CI (KC)

Project: [KarmaCummunity_MVP-2](https://sonarcloud.io/project/overview?id=KarmaCummunity_MVP-2)  
Organization: `karmacummunity`

## 1. Connect SonarQube for IDE in Cursor

1. Install extension **SonarQube for IDE** (SonarSource).
2. Command Palette → **SonarQube: Connect to SonarCloud** (or **New SonarQube Cloud Connection**).
3. **Generate Token** in SonarCloud → **My Account → Security** → paste into **User Token**.
4. **Organization**: `karmacummunity`.
5. **Save Connection**, then bind workspace to project **KarmaCummunity_MVP-2**.
6. Open the repo root (not only `app/`).

## 2. CI — block PRs into main with new Sonar issues

Workflow: [`.github/workflows/ci-sonar.yml`](../../.github/workflows/ci-sonar.yml)

Called by the `frontend` lane of `CI gate` (`ci-frontend.yml`) on PRs into `main` whose `frontend` lane runs (not for Dependabot) and on pushes to `main`. PRs into `dev` do not run it: they get fast feedback only, and the free SonarCloud plan analyses only `main` and pull requests, so neither the `dev` merge queue nor `dev` pushes can be scanned (`D-195` addendum, `TD-236`). New-code findings therefore surface on the release PR:

1. Downloads the tests job's lcov coverage and runs SonarCloud analysis on the PR branch.
2. Waits for the **Quality Gate** (`sonar.qualitygate.wait=true`).
3. **Fails the lane** if the gate fails on **new code**, which fails `CI gate` and blocks the merge.

New-code coverage only counts files that vitest measures. Keep `sonar.coverage.exclusions` a superset of each package's vitest coverage `exclude` list; a file vitest skips shows 0% here and fails the gate on any PR that touches it.

### One-time setup (repo admin)

1. **SonarCloud token**  
   SonarCloud → **My Account → Security** → Generate token (e.g. `github-actions`).

2. **GitHub secret**  
   GitHub repo `KarmaCummunity/KC` → **Settings → Secrets and variables → Actions** →  
   New secret: `SONAR_TOKEN` = the token above.  
   (Prefer **organization** secret if multiple repos use the same Sonar org.)

3. **Disable duplicate analysis**  
   SonarCloud → **MVP-2 → Administration → Analysis Method** → turn off **Automatic Analysis**  
   (CI workflow replaces it; avoids double scans.)

4. **No separate required check.** Sonar runs inside `CI gate`, the only required check on `dev` and `main` (`D-195`); never require `SonarCloud quality gate` on its own.

> **Note:** Git cannot reject `git push` from the server before upload. Protection works by **required PR checks** + **no merge** until Sonar passes. Direct pushes to `dev`/`main` should be disallowed by branch rules.

### Waivers / minor issues (Sonar-side)

Issues you accept in SonarCloud **do not block** the Quality Gate when marked:

| Action in SonarCloud UI | Effect |
|-------------------------|--------|
| **False Positive** | Excluded from gate on that issue |
| **Won't Fix** | Excluded |
| **Accept** (Accepted Issues) | Excluded from “new issues” counts |

Use **Project → Issues** → open issue → **⋯** → choose resolution.  
Tune the gate under **Project → Quality Gate** (e.g. allow `INFO`-only new smells) if needed.

## 3. Local scan (optional)

```bash
export SONAR_TOKEN="<your-token>"
sonar-scanner \
  -Dsonar.host.url=https://sonarcloud.io \
  -Dsonar.token="$SONAR_TOKEN"
```

Config: [`sonar-project.properties`](../../sonar-project.properties) at repo root.

List open issues (public read API):

```bash
./scripts/sonar-fetch-issues.sh SECURITY
./scripts/sonar-fetch-issues.sh RELIABILITY
```

## 4. Ask Claude to fix Sonar issues

Priority: **Security** → **Reliability (BUG)** → **BLOCKER/CRITICAL** on new code → maintainability (large backlog).

Paste Sonar issue list or: “continue fixing Sonar RELIABILITY on PR branch”.
