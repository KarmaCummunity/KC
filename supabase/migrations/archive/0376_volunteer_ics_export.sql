-- 0376_volunteer_ics_export | Calendar .ics payload for signed-up shifts.

begin;

create or replace function public.get_volunteer_shift_ics(p_shift_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_s public.volunteer_shifts%rowtype;
  v_o public.volunteer_opportunities%rowtype;
  v_ok boolean;
begin
  select * into v_s from public.volunteer_shifts where shift_id = p_shift_id;
  if not found then return null; end if;
  select * into v_o from public.volunteer_opportunities where opportunity_id = v_s.opportunity_id;

  v_ok := v_o.organizer_id = v_uid or exists (
    select 1 from public.volunteer_shift_signups su
     where su.shift_id = p_shift_id and su.user_id = v_uid
       and su.status in ('registered','waitlisted','checked_in')
  );
  if not v_ok then raise exception 'forbidden' using errcode = '42501'; end if;

  return concat(
    'BEGIN:VCALENDAR', chr(10),
    'VERSION:2.0', chr(10),
    'PRODID:-//Karma Community//Volunteer Shift//EN', chr(10),
    'BEGIN:VEVENT', chr(10),
    'UID:volunteer-shift-', p_shift_id::text, '@karma-community.local', chr(10),
    'DTSTAMP:', to_char(now() at time zone 'utc', 'YYYYMMDD"T"HH24MISS"Z"'), chr(10),
    'DTSTART:', to_char(v_s.starts_at at time zone 'utc', 'YYYYMMDD"T"HH24MISS"Z"'), chr(10),
    'DTEND:', to_char(v_s.ends_at at time zone 'utc', 'YYYYMMDD"T"HH24MISS"Z"'), chr(10),
    'SUMMARY:', replace(v_o.title, ',', '\,'), chr(10),
    'DESCRIPTION:Volunteer shift via KC Time world', chr(10),
    'END:VEVENT', chr(10),
    'END:VCALENDAR'
  );
end;
$$;

revoke all on function public.get_volunteer_shift_ics(uuid) from public;
grant execute on function public.get_volunteer_shift_ics(uuid) to authenticated;

commit;
