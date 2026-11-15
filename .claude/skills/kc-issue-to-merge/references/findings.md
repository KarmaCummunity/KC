# Findings outside the scope

Read at Phase 6. A finding is real work you noticed but the current issue does not cover.
Fix nothing outside the scope inline (AGENTS.md §5, "Propose and Proceed"). Record it, then continue the task.

## Is it a finding?

| Yes, open or extend an issue | No, handle it differently |
|---|---|
| A bug or wrong behavior, with a reproduction or a `file:line` | A typo or one-line fix inside a file you already change: fix it in this PR and mention it |
| Suspicious code: unchecked input, a race, a silent `catch`, a missing RLS check | A vague impression with no evidence: drop it |
| A flaky or missing test for existing behavior | Part of the current issue's acceptance criteria: it is not a finding, do it |
| A doc or spec that contradicts the code | A product question for the current issue: Phase 3 "Blocked" |
| Tech debt: over the size cap, a layering breach, dead code | |

## Steps

1. **De-duplicate** with 2-3 distinctive keywords. Use code identifiers and file names; they match better than prose.

   ```bash
   gh api -X GET search/issues -f per_page=8 -f q="repo:KarmaCummunity/KC is:issue <keywords> in:title,body" --jq '.items[] | "#\(.number) [\(.state)] \(.title)"'
   ```

   - **An open issue already covers it:** add a comment with the new evidence. Do not open a second issue.
   - **A closed issue covers it and the problem is back:** open a new issue that links the closed one as a regression.
2. **Group.** Several findings with one root cause make one issue. Open at most 5 issues per task; above that, open one umbrella issue with a checklist.
3. **Open** the issue with the body below:

   ```bash
   gh api -X POST $R/issues -f title="[<area>] <imperative outcome>" -F body=@<body-file> \
     -f 'labels[]=found-by-agent' -f 'labels[]=needs-triage' -f 'labels[]=<type>' -f 'labels[]=<area:*>' \
     -f 'labels[]=<priority:Px>' -f 'labels[]=<size:*>' --jq .html_url
   ```

   The priority you set is a suggestion; `needs-triage` keeps the issue out of the agent queue until the PM removes it. Write decisions in words, not as `{{KEY:slug}}` placeholders: GitHub text is never renumbered.
4. **Tech debt** is an issue like any other, with the `tech-debt` type label; its issue number is its ID (AGENTS.md §4). There is no tech-debt doc to update.
5. **Record** every finding in the PR body: `Findings opened: #a, #b`.

## Issue body

```markdown
### Area
<mobile | backend/db | web | CI/DevOps | spec/docs | GTM>

### Context
Found while working on #<N> (PR #<PR>).
<What is wrong, and why it matters to users or to the codebase.>

**Evidence:** `<path>:<line>` · <reproduction steps or the failing log line>

### Spec ref
<docs/spec section, D#, G#, or "none found">

### Acceptance criteria
- [ ] <observable outcome>
- [ ] A regression test covers it
- [ ] Spec and SSOT docs updated in the same PR

### Test plan
<Levels from testing-matrix.md and what each proves>

### Likely files
<paths>

### Migration
none

### Out of scope
<what the fix must not touch>
```

## Security findings

- **Public text (issue, PR, commit, comment):** a generic title such as `[security] Hardening needed in <area>` and the body `Details shared privately with the PM.` Labels: `area:security`, `found-by-agent`, `needs-triage`. Never the vulnerable path, payload or reproduction.
- **The details** (where, how to reproduce, impact) go only to the PM, in your conversation with them (AGENTS.md §7).
- **If the current task makes the hole worse,** stop and treat it as a product question (Phase 3, "Blocked").
