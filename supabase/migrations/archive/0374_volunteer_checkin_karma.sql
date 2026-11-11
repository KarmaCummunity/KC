-- 0374_volunteer_checkin_karma | Check-in, logged hours, karma + impact totals.

begin;

drop index if exists public.karma_ledger_once_idx;
create unique index karma_ledger_once_idx
  on public.karma_ledger (user_id, event_type, ref_id)
  where event_type in (
    'registration', 'post_created', 'outreach', 'backfill', 'listing_fulfilled', 'volunteer_checkin'
  );

create or replace function public.check_in_volunteer_shift(p_signup_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_su public.volunteer_shift_signups%rowtype;
  v_s public.volunteer_shifts%rowtype;
  v_hours numeric;
  v_points int;
begin
  select * into v_su from public.volunteer_shift_signups
   where signup_id = p_signup_id and user_id = v_uid for update;
  if not found then raise exception 'signup_not_found' using errcode = 'P0002'; end if;
  if v_su.status <> 'registered' then
    raise exception 'not_registered' using errcode = '23514';
  end if;

  select * into v_s from public.volunteer_shifts where shift_id = v_su.shift_id;
  if now() < v_s.starts_at - interval '2 hours' or now() > v_s.ends_at + interval '4 hours' then
    raise exception 'checkin_window' using errcode = '23514';
  end if;

  v_hours := round(
    extract(epoch from (least(now(), v_s.ends_at) - v_s.starts_at)) / 3600.0,
    2
  );
  if v_hours < 0.25 then v_hours := 0.25; end if;

  update public.volunteer_shift_signups
     set status = 'checked_in', checked_in_at = now(), hours_logged = v_hours
   where signup_id = p_signup_id;

  v_points := greatest(1, round(v_hours)::int);
  perform public.karma_grant_once(v_uid, 'volunteer_checkin', 'volunteer_signup', p_signup_id::text, v_points);

  update public.users
     set volunteer_hours_total = volunteer_hours_total + v_hours
   where user_id = v_uid;

  return jsonb_build_object('hours_logged', v_hours, 'karma_points', v_points);
end;
$$;

revoke all on function public.check_in_volunteer_shift(uuid) from public;
grant execute on function public.check_in_volunteer_shift(uuid) to authenticated;

commit;
