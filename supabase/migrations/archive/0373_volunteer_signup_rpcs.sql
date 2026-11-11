-- 0373_volunteer_signup_rpcs | Sign-up, waitlist, cancel with promotion.

begin;

create or replace function public.volunteer_enqueue_signup_notifications(p_signup_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_su public.volunteer_shift_signups%rowtype;
  v_s public.volunteer_shifts%rowtype;
  v_o public.volunteer_opportunities%rowtype;
begin
  select * into v_su from public.volunteer_shift_signups where signup_id = p_signup_id;
  if not found then return; end if;
  select * into v_s from public.volunteer_shifts where shift_id = v_su.shift_id;
  select * into v_o from public.volunteer_opportunities where opportunity_id = v_s.opportunity_id;

  perform public.enqueue_notification(
    v_su.user_id,
    'social',
    'volunteer_signup_confirmed',
    'notifications.volunteerSignupTitle',
    'notifications.volunteerSignupBody',
    jsonb_build_object('title', v_o.title, 'starts_at', v_s.starts_at),
    jsonb_build_object(
      'route', '/(tabs)/donations/time/opportunity/' || v_o.opportunity_id::text,
      'opportunity_id', v_o.opportunity_id,
      'shift_id', v_s.shift_id
    ),
    'volunteer_signup:' || v_su.signup_id::text,
    false
  );
exception when others then null;
end;
$$;

create or replace function public._volunteer_promote_waitlist(p_shift_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cap int;
  v_filled int;
  v_next uuid;
begin
  select capacity into v_cap from public.volunteer_shifts where shift_id = p_shift_id;
  select count(*)::int into v_filled from public.volunteer_shift_signups
   where shift_id = p_shift_id and status in ('registered','checked_in');
  while v_filled < v_cap loop
    select signup_id into v_next
      from public.volunteer_shift_signups
     where shift_id = p_shift_id and status = 'waitlisted'
     order by waitlist_position nulls last, signed_up_at
     limit 1
     for update skip locked;
    exit when v_next is null;
    update public.volunteer_shift_signups
       set status = 'registered', waitlist_position = null
     where signup_id = v_next;
    v_filled := v_filled + 1;
  end loop;
end;
$$;

create or replace function public.sign_up_volunteer_shift(p_shift_id uuid)
returns public.volunteer_shift_signups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_cap int;
  v_filled int;
  v_row public.volunteer_shift_signups;
  v_opp uuid;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  select s.capacity, s.opportunity_id into v_cap, v_opp
    from public.volunteer_shifts s
    join public.volunteer_opportunities o on o.opportunity_id = s.opportunity_id
   where s.shift_id = p_shift_id and o.status = 'open' and s.ends_at > now();
  if not found then raise exception 'shift_not_open' using errcode = 'P0002'; end if;

  select count(*)::int into v_filled from public.volunteer_shift_signups
   where shift_id = p_shift_id and status in ('registered','checked_in');

  if v_filled < v_cap then
    insert into public.volunteer_shift_signups (shift_id, user_id, status)
    values (p_shift_id, v_uid, 'registered')
    on conflict (shift_id, user_id) do update
      set status = excluded.status, signed_up_at = now(), waitlist_position = null
      where volunteer_shift_signups.status = 'cancelled'
    returning * into v_row;
  else
    insert into public.volunteer_shift_signups (shift_id, user_id, status, waitlist_position)
    values (
      p_shift_id, v_uid, 'waitlisted',
      1 + coalesce((
        select max(waitlist_position) from public.volunteer_shift_signups
         where shift_id = p_shift_id and status = 'waitlisted'
      ), 0)
    )
    on conflict (shift_id, user_id) do update
      set status = 'waitlisted', signed_up_at = now()
      where volunteer_shift_signups.status = 'cancelled'
    returning * into v_row;
  end if;

  perform public.volunteer_enqueue_signup_notifications(v_row.signup_id);
  return v_row;
end;
$$;

create or replace function public.cancel_volunteer_signup(p_signup_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift uuid;
  v_old text;
begin
  select shift_id, status into v_shift, v_old
    from public.volunteer_shift_signups
   where signup_id = p_signup_id and user_id = auth.uid()
     and status in ('registered','waitlisted')
   for update;
  if not found then raise exception 'signup_not_found' using errcode = 'P0002'; end if;

  update public.volunteer_shift_signups
     set status = 'cancelled', waitlist_position = null
   where signup_id = p_signup_id;

  if v_old = 'registered' then
    perform public._volunteer_promote_waitlist(v_shift);
  end if;
end;
$$;

create or replace function public.list_my_volunteer_signups(p_limit int default 50)
returns table (
  signup_id uuid,
  shift_id uuid,
  opportunity_id uuid,
  title text,
  starts_at timestamptz,
  ends_at timestamptz,
  status text,
  hours_logged numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    su.signup_id,
    su.shift_id,
    o.opportunity_id,
    o.title,
    s.starts_at,
    s.ends_at,
    su.status,
    su.hours_logged
  from public.volunteer_shift_signups su
  join public.volunteer_shifts s on s.shift_id = su.shift_id
  join public.volunteer_opportunities o on o.opportunity_id = s.opportunity_id
  where su.user_id = auth.uid() and su.status <> 'cancelled'
  order by s.starts_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

revoke all on function public.sign_up_volunteer_shift(uuid) from public;
grant execute on function public.sign_up_volunteer_shift(uuid) to authenticated;
revoke all on function public.cancel_volunteer_signup(uuid) from public;
grant execute on function public.cancel_volunteer_signup(uuid) to authenticated;
revoke all on function public.list_my_volunteer_signups(int) from public;
grant execute on function public.list_my_volunteer_signups(int) to authenticated;

commit;
