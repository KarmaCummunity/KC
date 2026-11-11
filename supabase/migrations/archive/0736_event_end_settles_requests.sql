-- 0736_event_end_settles_requests | When an event ends, its open requests and its waitlist lapse
-- (G18 end-to-end review, #1467; D128)
--
-- `events_expired_sweep` (0685) expires an event when its window ends but left its registrations
-- as they were. Confirmed ones are right to stay: the organizer marks attendance after the end
-- (0564, D124). An unanswered request (`reserved`) and a waitlisted member, though, stayed
-- "waiting" on an event that is over. The sweep now cancels those two as `expired`, in the same
-- statement as the expiry; the registration push (0731) tells each member why.

create or replace function public.events_expired_sweep()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  with ended as (
    update public.posts p
       set status = 'expired', updated_at = now()
      from public.event_post_details e
     where e.post_id = p.post_id
       and e.ends_at <= now()
       and p.status in ('open', 'paused')
    returning p.post_id
  ), lapsed as (
    -- 0736: a request nobody answered and a place that never freed up end with the event.
    update public.post_handoffs h
       set status = 'cancelled', cancel_reason = 'expired', cancelled_at = now()
      from ended
     where h.post_id = ended.post_id
       and h.world_slug = 'time'
       and h.status in ('reserved', 'waitlisted')
    returning h.handoff_id
  )
  select count(*)::int into v_count from ended;
  return v_count;
end;
$$;

comment on function public.events_expired_sweep() is
  'D128 (0685, 0736): expires an open or paused event when its window ends, and lapses its unanswered requests and waitlist; confirmed registrations stay for attendance marking.';
