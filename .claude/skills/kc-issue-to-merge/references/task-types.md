# Task types

Read at Phase 3. What "done" means depends on the type, and only what CI can prove belongs in an agent's issue.

## Done, per type

| Type (label) | Done when | Must include | Watch out |
|---|---|---|---|
| Feature (`enhancement`) | Every acceptance criterion is proven by an automated test and the PR merged | Spec section updated; tests at each level the change touches | User-visible behavior the spec does not settle is a product question |
| Bug (`bug`) | A regression test failed before the fix and passes after it | Root cause in the PR body, not just the symptom | Fix the cause, not the test; a flaky test is a bug in the test or the code |
| Tech debt / refactor (`tech-debt`) | Behavior unchanged; existing tests green; the debt named in the issue is gone | No new behavior; size ≤ M, otherwise split | Adjacent debt is a finding, not scope |
| Spec / docs (`documentation`) | Guards green (`pnpm lint:arch`: links, spec IDs) | `{{KEY:slug}}` placeholders for new registry rows (KEY per AGENTS.md §4) | New product content needs the PM |
| CI / tooling (`area:ci`) | Script self-test (`scripts/*.test.mjs`) and actionlint pass | The workflow still runs the checks it ran before | Never weaken a gate to get green |
| Database (`database`) | pgTAP test with allowed and denied actor passes in CI | `next-NN_slug.sql`; types regenerated if the API surface changed | No destructive SQL without a waiver line; no MCP `apply_migration` |
| Security (`area:security`) | As its type, plus no public detail anywhere | Generic public title; details only to the PM | Never describe the hole in commits, PRs or comments |
| E2E test owed (`needs-e2e`, "[NEEDS E2E VERIFY]") | The automated journey passes against kc-dev | The journey (`tests/e2e/journeys/`, or a Maestro flow for native-only behavior). First confirm the feature can run on kc-dev: its reference data, kinds and flags are there | A feature that cannot run on kc-dev is not test work: it is a finding, or a product question when making it run is a launch decision. The proof runs after the merge (`ci-and-merge.md`) |
| Verification (`verification`) | A person ran the checklist and closed it | Steps, environment, expected result | Agents never take these |
| Epic (`epic`) | Its children are done | Children fully defined | Take the first child, not the epic |
| Ops alert (`ops-alert`) | Not agent queue work | — | Skip |

## Split: development versus verification

An agent closes only what CI proves. When an issue's acceptance criteria include something only a person can check, split it at Phase 3:
- a physical device;
- a TestFlight or Play internal build;
- a store console;
- a credential, contract or external account;
- a visual or UX judgment.

1. **This issue keeps the development part.** Rewrite its acceptance criteria to what automated tests prove, under `### Filled in by agent:<you>`, and say that the rest moved. It closes when the PR merges (`Closes #<N>`).
2. **Open one verification issue** (body below) with the labels `verification`, `human`, the same `priority:*` labels, and the area labels. The queue never offers it to an agent.
3. **Link both ways.** The verification issue says `Verifies #<N>`; this issue's comment names the verification issue; the PR body lists it.
4. **Release gate.** Open `verification` issues for work on `dev` block the `dev` → `main` release until a person closes them or the PM waives them in the release PR (`docs/SSOT/RELEASE_CHECKLIST.md`).

When **every** criterion needs a person, do not split: Phase 1 skips the issue with `needs-triage` and a comment, and the PM decides.

### Verification issue body

```markdown
Verifies #<N> (development part, merged in #<PR> or pending).

### Environment
<kc-dev web | Android preview build N | TestFlight X.Y.Z | store console>

### Checklist
- [ ] <step a person does> → <expected result>
- [ ] <step> → <expected result>

### Evidence
Attach a screenshot or a short recording per checklist line, then close the issue.

### If it fails
Open a `bug` that cites this issue, with the step, the device and app version, and what happened instead.
```

Title: `[verify] <what is checked>`.
