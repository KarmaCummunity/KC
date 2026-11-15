-- 0384_handoff_complete_karma | Handed over, no-show, karma + rating RPC.

begin;

drop index if exists public.karma_ledger_once_idx;
create unique index karma_ledger_once_idx
  on public.karma_ledger (user_id, event_type, ref_id)
  where event_type in (
    'registration', 'post_created', 'outreach', 'backfill', 'listing_fulfilled',
    'volunteer_checkin', 'giving_handoff_giver', 'giving_handoff_receiver'
  );

create or replace function public.karma_grant_once(
  p_user uuid, p_event text, p_ref_type text, p_ref_id text, p_delta integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_inserted integer;
begin
  if p_user is null then return; end if;
  insert into public.karma_ledger (user_id, event_type, points_delta, ref_type, ref_id)
  values (p_user, p_event, p_delta, p_ref_type, p_ref_id)
  on conflict (user_id, event_type, ref_id)
    where event_type in (
      'registration', 'post_created', 'outreach', 'backfill', 'listing_fulfilled',
      'volunteer_checkin', 'giving_handoff_giver', 'giving_handoff_receiver'
    )
    do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted > 0 then
    update public.users set karma_points = greatest(0, karma_points + p_delta)
     where user_id = p_user;
  end if;
end;
$$;

create or replace function public.mark_giving_handed_over(p_handoff_id uuid)
returns public.giving_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.giving_handoffs;
begin
  update public.giving_handoffs
     set status = 'handed_over', handed_over_at = now()
   where handoff_id = p_handoff_id
     and status = 'confirmed'
     and (owner_id = auth.uid() or recipient_id = auth.uid())
  returning * into v_row;
  if not found then raise exception 'handoff_not_confirmed' using errcode = '23514'; end if;

  update public.listings
     set status = 'closed', availability_status = 'ongoing', updated_at = now()
   where listing_id = v_row.listing_id;

  perform public.karma_grant_once(v_row.owner_id, 'giving_handoff_giver', 'giving_handoff', p_handoff_id::text, 5);
  perform public.karma_grant_once(v_row.recipient_id, 'giving_handoff_receiver', 'giving_handoff', p_handoff_id::text, 3);

  return v_row;
end;
$$;

create or replace function public.rate_giving_handoff(
  p_handoff_id uuid,
  p_rating smallint,
  p_comment text default null
)
returns public.giving_handoff_ratings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_h public.giving_handoffs%rowtype;
  v_rater uuid := auth.uid();
  v_ratee uuid;
  v_row public.giving_handoff_ratings;
begin
  if v_rater is null then raise exception 'auth_required' using errcode = '42501'; end if;
  if p_rating < 1 or p_rating > 5 then raise exception 'invalid_rating' using errcode = '23514'; end if;

  select * into v_h from public.giving_handoffs where handoff_id = p_handoff_id and status = 'handed_over';
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;

  if v_rater = v_h.owner_id then v_ratee := v_h.recipient_id;
  elsif v_rater = v_h.recipient_id then v_ratee := v_h.owner_id;
  else raise exception 'not_participant' using errcode = '42501';
  end if;

  insert into public.giving_handoff_ratings (handoff_id, rater_id, ratee_id, rating, comment)
  values (p_handoff_id, v_rater, v_ratee, p_rating, nullif(trim(p_comment), ''))
  on conflict (handoff_id, rater_id) do update
    set rating = excluded.rating, comment = excluded.comment
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.mark_giving_handed_over(uuid) from public;
grant execute on function public.mark_giving_handed_over(uuid) to authenticated;
revoke all on function public.rate_giving_handoff(uuid, smallint, text) from public;
grant execute on function public.rate_giving_handoff(uuid, smallint, text) to authenticated;

commit;
