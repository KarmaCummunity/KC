<!--
PR description template — keep all sections.
The agent (or a human) fills these in. CI will block merge if "Mapped to spec" is missing.
-->

## Opened by
<!-- Keep exactly one line; delete the rest. CI applies the matching label. -->
Opened by: agent:cursor | agent:kc-bot | agent:antigravity | agent:codex | agent:other | human

## Summary
<!-- 2-4 sentences: what changed and why. -->

## Contributor License Agreement

- [ ] I have read and agree to the [Contributor License Agreement](../CLA.md).

## Mapped to spec
<!-- Required. List FR-* IDs touched, or write "N/A — tooling/docs only".
     Link to docs/spec/requirements/<file>.md when applicable. -->
- FR-XXX-NNN — <title>

## Changes
<!-- Concrete list of edits — files added / changed / removed, plus key behavioral effects.
     Prefer one issue per PR and keep the diff reviewable (~≤300 lines when possible). -->
-

## Tests
<!-- Mark each gate. Run from app/. -->
- [ ] `pnpm typecheck` ✅
- [ ] `pnpm test` ✅
- [ ] `pnpm lint` ✅
- [ ] Manual smoke (describe) or N/A

## Refactor logged
<!-- Yes / No / NA. If Yes, link to the `tech-debt` issue. -->
- NA

## SSOT updated
<!-- Required when an FR-* is touched. Tick when each is in sync in this PR. -->
- [ ] Issue linked (`Closes #N`) and board status correct
- [ ] `docs/spec/requirements/{domain}.md` status updated (if all ACs done)

## Risk / rollout notes
<!-- DB migrations, RLS changes, feature flag, breaking change? Otherwise "Low risk." -->
-

## Screenshots / logs
<!-- Only if UI or runtime output changed. -->
