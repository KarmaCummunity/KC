# Release safety justifications

The weekly release train copies every `Migration safety:` line below into the
release PR body (`main` ← `dev`). The strict release scan
(`scripts/check-migration-safety.mjs --release`) fails a release whose
destructive or compatibility-breaking migration has no line here. The train's
`plan` step runs the same scan against this file, so a missing line stops the
train before it freezes dev.

Format, one line per migration file (reason at least 10 characters):

    Migration safety: <file name ending in sql> — <why PROD can take this change safely>

Migration safety: 0085_match_process_time_budget.sql — kc_private.match_process(integer) is replaced by (integer, interval) with defaults; only the scheduled job calls it and there is no client grant.
Migration safety: 0091_post_media_processing_activation.sql — both dropped functions were added by 0084 in this same release, so PROD never ran code that calls them.
