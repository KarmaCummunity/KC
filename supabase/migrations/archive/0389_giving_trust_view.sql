-- 0389_giving_trust_view | Trust score blends match + handoff ratings.

begin;

create or replace view public.giving_user_trust_score
with (security_invoker = true) as
select
  u.user_id,
  coalesce(
    (
      select avg(r.rating)::numeric / 5.0
        from public.giving_handoff_ratings r
       where r.ratee_id = u.user_id
    ),
    0.5
  )::numeric(6, 4) as handoff_trust_score,
  coalesce(ts.trust_score, 0.5)::numeric(6, 4) as match_trust_score,
  (
    coalesce(
      (select avg(r.rating)::numeric / 5.0 from public.giving_handoff_ratings r where r.ratee_id = u.user_id),
      0.5
    ) * 0.6
    + coalesce(ts.trust_score, 0.5) * 0.4
  )::numeric(6, 4) as combined_trust_score
from public.users u
left join public.listing_owner_trust_score ts on ts.user_id = u.user_id;

grant select on public.giving_user_trust_score to authenticated, service_role;

commit;
