# Define and label a task

Read at Phase 3. Goal: the issue alone is enough for any agent to finish it in one PR without asking.

## A well-defined issue has

| Part | Requirement |
|---|---|
| Title | `[area] <imperative outcome>`. Product language from `docs/spec/94_glossary_and_naming.md`. |
| Context | Why it matters, current behavior, links to related issues and PRs. |
| Spec ref | `docs/spec` section, D#, G# (legacy `docs/spec/requirements/*` FR-ID if any). `none found` only after searching. |
| Acceptance criteria | Testable checkboxes, each observable from outside the code. |
| Test plan | The levels from `testing-matrix.md` and what each test proves. |
| Likely files | Paths, so the next agent searches less. |
| Migration range | A claimed range, or `none`. |
| Out of scope | What this issue does not do. Prevents scope creep. |

The `Agent task` issue form (`.github/ISSUE_TEMPLATE/agent-task.yml`) has these fields; mirror them when you edit or create an issue body.

## Gap policy

**Technical gap: fill it and continue.** Write the additions under `### Filled in by agent:<you>` at the end of the body, never silently rewriting the PM's text:

```bash
f=$(mktemp)
gh api $R/issues/<N> --jq .body > "$f"
printf '\n\n### Filled in by agent:<you>\n%s\n' "<additions>" >> "$f"
gh api -X PATCH $R/issues/<N> -F body=@"$f" --jq .html_url
```

- Acceptance criteria derivable from the cited spec.
- A test plan, likely files, an out-of-scope list.
- Missing labels.

**Product question: stop, mark blocked, take another issue.**

- The task contradicts `docs/spec/` (or the legacy requirements file).
- The spec is silent on behavior a user will see: copy, flow, permissions, pricing, who sees what.
- Two reasonable readings give users different behavior.
- The change needs a credential, a contract or a production action.

### Blocked

```bash
gh api -X POST $R/issues/<N>/labels -f 'labels[]=blocked' --jq 'map(.name)'
gh api -X DELETE $R/issues/<N>/labels/in-progress --silent
gh api -X DELETE $R/issues/<N>/labels/agent:<you> --silent
gh api -X POST $R/issues/<N>/comments -F body=@<comment-file> --jq .html_url
```

The comment (English) has exactly three parts:
- **Question:** one sentence.
- **Options:** two or three, each with its user-visible effect.
- **Recommendation:** one, with the reason.

Tell the PM the same question in the conversation, in Hebrew. If your token can write the board, set Status = Blocked.

## Label taxonomy

Every task issue carries exactly one label from each required group.

| Group | Labels | Rule |
|---|---|---|
| Type (required) | `bug`, `enhancement`, `tech-debt`, `documentation`, `performance` | What the change is. |
| Area (required, 1+) | `area:mobile`, `area:worlds`, `area:social`, `area:moderation`, `area:security`, `area:i18n`, `area:a11y`, `area:design-system`, `area:architecture`, `area:observability`, `area:ci`, `area:docs`, `area:release`, `area:whatsapp-bot`, `database` | Every area the change touches. `database` for `supabase/**` SQL. |
| Priority (required) | `priority:P0` … `priority:P3` | Keep the PM's value. Set one only on an unprioritized issue you were explicitly given. |
| Launch flag | `priority:launch` | Required for the upcoming launch; ranks above P0 in the queue. Only the PM sets it. |
| Size (required) | `size:XS`, `size:S`, `size:M`, `size:L`, `size:XL` | Your estimate: XS < 1h, S < ½ day, M ≈ 1 day, L 2-3 days, XL needs splitting. |
| Flags | `epic`, `blocked`, `possible-duplicate`, `needs-triage`, `found-by-agent` | Only when true. |
| Claim | `in-progress` + `agent:<you>` | Set in Phase 2, removed on merge or release. |

Do not invent labels. Before using a new one, add it to `.github/workflows/sync-agent-labels.yml` in a PR.

## Size XL means split

An `XL` issue becomes an epic:
1. Open one child issue per independently mergeable step, each fully defined and labeled.
2. Link the children from the parent.
3. Label the parent `epic`.
4. Take the first child.
