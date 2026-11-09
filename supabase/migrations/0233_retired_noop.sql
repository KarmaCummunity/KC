-- 0233 — retired no-op. This version shipped schema for a product that was later
-- retired (D-190); databases that applied it dropped that schema within the
-- same range. The file stays so the version keeps a local match in the
-- migration ledger.
select 1;
