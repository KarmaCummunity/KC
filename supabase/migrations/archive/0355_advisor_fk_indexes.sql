-- 0355_advisor_fk_indexes | KC#945 — indexes on FK columns missing covering indexes.
-- CREATE INDEX on tables that may not exist yet is gated (volunteer/handoff land at 0370/0380).

begin;

create index if not exists listing_user_signals_listing_idx
  on public.listing_user_signals (listing_id);

do $$
begin
  if to_regclass('public.volunteer_opportunities') is not null then
    execute 'create index if not exists volunteer_opportunities_organizer_idx
      on public.volunteer_opportunities (organizer_id)';
    execute 'create index if not exists volunteer_opportunities_org_idx
      on public.volunteer_opportunities (org_id)
      where org_id is not null';
  end if;
  if to_regclass('public.volunteer_shifts') is not null then
    execute 'create index if not exists volunteer_shifts_opportunity_idx
      on public.volunteer_shifts (opportunity_id)';
  end if;
  if to_regclass('public.volunteer_shift_signups') is not null then
    execute 'create index if not exists volunteer_signups_shift_idx
      on public.volunteer_shift_signups (shift_id)';
  end if;
  if to_regclass('public.giving_handoff_ratings') is not null then
    execute 'create index if not exists giving_handoff_ratings_handoff_idx
      on public.giving_handoff_ratings (handoff_id)';
    execute 'create index if not exists giving_handoff_ratings_rater_idx
      on public.giving_handoff_ratings (rater_id)';
    execute 'create index if not exists giving_handoff_ratings_ratee_idx
      on public.giving_handoff_ratings (ratee_id)';
  end if;
end $$;

-- money world: beneficiary org FK on listings (0360+)
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'listings'
       and column_name = 'beneficiary_org_id'
  ) then
    execute 'create index if not exists listings_beneficiary_org_idx
      on public.listings (beneficiary_org_id)
      where beneficiary_org_id is not null';
  end if;
end $$;

commit;
