-- 0375_volunteer_organizer_manage | Roster + organizer broadcast via outbox.

begin;

create or replace function public.list_shift_volunteers(p_shift_id uuid)
returns table (
  signup_id uuid,
  user_id uuid,
  display_name text,
  share_handle text,
  status text,
  waitlist_position int,
  hours_logged numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    su.signup_id,
    su.user_id,
    u.display_name,
    u.share_handle,
    su.status,
    su.waitlist_position,
    su.hours_logged
  from public.volunteer_shift_signups su
  join public.users u on u.user_id = su.user_id
  join public.volunteer_shifts s on s.shift_id = su.shift_id
  join public.volunteer_opportunities o on o.opportunity_id = s.opportunity_id
  where su.shift_id = p_shift_id
    and o.organizer_id = auth.uid()
    and su.status <> 'cancelled'
  order by
    case su.status when 'checked_in' then 0 when 'registered' then 1 when 'waitlisted' then 2 else 3 end,
    su.waitlist_position nulls last,
    su.signed_up_at;
$$;

create or replace function public.organizer_message_shift_volunteers(
  p_shift_id uuid,
  p_message text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_o uuid;
  v_title text;
  v_count int := 0;
  r record;
begin
  select o.opportunity_id, o.title into v_o, v_title
    from public.volunteer_shifts s
    join public.volunteer_opportunities o on o.opportunity_id = s.opportunity_id
   where s.shift_id = p_shift_id and o.organizer_id = auth.uid();
  if not found then raise exception 'not_organizer' using errcode = '42501'; end if;
  if nullif(trim(p_message), '') is null then
    raise exception 'message_required' using errcode = '23514';
  end if;

  for r in
    select su.user_id
      from public.volunteer_shift_signups su
     where su.shift_id = p_shift_id and su.status in ('registered','waitlisted','checked_in')
  loop
    perform public.enqueue_notification(
      r.user_id,
      'social',
      'volunteer_organizer_message',
      'notifications.volunteerOrganizerTitle',
      'notifications.volunteerOrganizerBody',
      jsonb_build_object('title', v_title, 'message', left(trim(p_message), 500)),
      jsonb_build_object(
        'route', '/(tabs)/donations/time/opportunity/' || v_o::text,
        'shift_id', p_shift_id
      ),
      'volunteer_org_msg:' || p_shift_id::text || ':' || r.user_id::text || ':' || md5(trim(p_message)),
      false
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.list_shift_volunteers(uuid) from public;
grant execute on function public.list_shift_volunteers(uuid) to authenticated;
revoke all on function public.organizer_message_shift_volunteers(uuid, text) from public;
grant execute on function public.organizer_message_shift_volunteers(uuid, text) to authenticated;

commit;
