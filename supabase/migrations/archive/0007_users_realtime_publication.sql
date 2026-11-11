-- 0007_users_realtime_publication | P0.2.f1 — FR-PROFILE-013 AC5, NFR-PERF-005
-- Adds `public.users` to supabase_realtime so counter UPDATEs are projected to clients.
-- Missed in 0006: triggers were added but the publication add-table was forgotten.
-- RLS applies on broadcast — Realtime only delivers rows the subscriber can SELECT
-- under policies from 0001 + 0003 (Public rows + self + approved-follower expansion).

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'users'
    ) then
      execute 'alter publication supabase_realtime add table public.users';
    end if;
  end if;
end $$;

-- end of 0007_users_realtime_publication
