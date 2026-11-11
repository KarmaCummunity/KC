-- 0354_advisor_rls_initplan | KC#945 — wrap auth.uid() in (select …) for RLS initplan.
-- Derived: kc-dev advisors MCP unavailable; fix policies still using bare auth.uid()
-- in USING/WITH CHECK (TD-173 / Supabase perf guidance).
-- Tables created after this version (0370 volunteer, 0380 handoff) are gated so a
-- fresh chain can apply 0354 before those schemas exist; 0370/0380 ship the same
-- initplan form for greenfield installs.

begin;

-- listing_user_signals (0323) — exists before 0354
drop policy if exists listing_user_signals_select_own on public.listing_user_signals;
create policy listing_user_signals_select_own on public.listing_user_signals
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists listing_user_signals_insert_own on public.listing_user_signals;
create policy listing_user_signals_insert_own on public.listing_user_signals
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- listing_media (0333)
drop policy if exists listing_media_select_visible on public.listing_media;
create policy listing_media_select_visible on public.listing_media
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.listings l
       where l.listing_id = listing_media.listing_id
         and l.moderation_status = 'published'
         and public.is_listing_visible_to(l, (select auth.uid()))
    )
  );

drop policy if exists listing_media_insert_owner on public.listing_media;
create policy listing_media_insert_owner on public.listing_media
  for insert to authenticated
  with check (
    exists (
      select 1 from public.listings l
       where l.listing_id = listing_media.listing_id
         and l.owner_id = (select auth.uid())
    )
  );

drop policy if exists listing_media_delete_owner on public.listing_media;
create policy listing_media_delete_owner on public.listing_media
  for delete to authenticated
  using (
    exists (
      select 1 from public.listings l
       where l.listing_id = listing_media.listing_id
         and l.owner_id = (select auth.uid())
    )
  );

-- storage listing_images (0333)
drop policy if exists listing_images_insert_own on storage.objects;
create policy listing_images_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'listing-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists listing_images_update_own on storage.objects;
create policy listing_images_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'listing-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists listing_images_delete_own on storage.objects;
create policy listing_images_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'listing-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- volunteer_* (0370) — only when already present (kc-dev / out-of-order apply)
do $$
begin
  if to_regclass('public.volunteer_opportunities') is null then
    return;
  end if;

  drop policy if exists volunteer_opportunities_read_open on public.volunteer_opportunities;
  create policy volunteer_opportunities_read_open on public.volunteer_opportunities
    for select to authenticated
    using (status = 'open' or organizer_id = (select auth.uid()));

  drop policy if exists volunteer_opportunities_organizer_write on public.volunteer_opportunities;
  create policy volunteer_opportunities_organizer_write on public.volunteer_opportunities
    for all to authenticated
    using (organizer_id = (select auth.uid()))
    with check (organizer_id = (select auth.uid()));

  drop policy if exists volunteer_shifts_organizer_write on public.volunteer_shifts;
  create policy volunteer_shifts_organizer_write on public.volunteer_shifts
    for all to authenticated
    using (
      exists (
        select 1 from public.volunteer_opportunities o
         where o.opportunity_id = volunteer_shifts.opportunity_id
           and o.organizer_id = (select auth.uid())
      )
    )
    with check (
      exists (
        select 1 from public.volunteer_opportunities o
         where o.opportunity_id = volunteer_shifts.opportunity_id
           and o.organizer_id = (select auth.uid())
      )
    );

  -- collapse dual SELECT on signups into one permissive policy
  drop policy if exists volunteer_signups_self on public.volunteer_shift_signups;
  drop policy if exists volunteer_signups_organizer_read on public.volunteer_shift_signups;
  drop policy if exists volunteer_signups_read on public.volunteer_shift_signups;
  create policy volunteer_signups_read on public.volunteer_shift_signups
    for select to authenticated
    using (
      user_id = (select auth.uid())
      or exists (
        select 1 from public.volunteer_shifts s
        join public.volunteer_opportunities o on o.opportunity_id = s.opportunity_id
         where s.shift_id = volunteer_shift_signups.shift_id
           and o.organizer_id = (select auth.uid())
      )
    );
end $$;

-- giving_handoffs / ratings (0380)
do $$
begin
  if to_regclass('public.giving_handoffs') is null then
    return;
  end if;

  drop policy if exists giving_handoffs_participant_read on public.giving_handoffs;
  create policy giving_handoffs_participant_read on public.giving_handoffs
    for select to authenticated
    using (
      owner_id = (select auth.uid())
      or recipient_id = (select auth.uid())
    );

  drop policy if exists giving_handoff_ratings_participant_read on public.giving_handoff_ratings;
  create policy giving_handoff_ratings_participant_read on public.giving_handoff_ratings
    for select to authenticated
    using (
      exists (
        select 1 from public.giving_handoffs h
         where h.handoff_id = giving_handoff_ratings.handoff_id
           and (
             h.owner_id = (select auth.uid())
             or h.recipient_id = (select auth.uid())
           )
      )
    );
end $$;

commit;
