-- 0742_activity_timeline_world | The personal activity timeline names each post's world
-- (FR-STATS-003, FR-CLOSURE-011 AC9, #2078; PM decision D141)
--
-- A closed volunteering post read «סימנת מסירה של …» in "What's happening with me", because the
-- timeline row had no world and the app could only print the item wording. The RPC now returns
-- `world_slug`: the world of the post's listing, or null for a social post or a post that is gone.
-- The app words a time-world row as volunteering. Adding a returned column changes the function's
-- type, so it is dropped and created again with the same name, argument, limit and grants.

drop function if exists public.rpc_my_activity_timeline(int);

create function public.rpc_my_activity_timeline(p_limit int default 30)
returns table (
  occurred_at timestamptz,
  kind text,
  post_id uuid,
  post_title text,
  actor_display_name text,
  world_slug text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_lim int;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  -- Same page bounds as 0044: 1 to 50 rows, 30 by default.
  v_lim := greatest(1, least(coalesce(p_limit, 30), 50));

  -- The log keeps its own title snapshot; the post is joined only for its world, so a row whose
  -- post was deleted keeps its line with a null world.
  return query
  select l.occurred_at, l.kind, l.post_id, l.post_title, l.actor_display_name,
         p.listing_world_slug::text
    from public.user_personal_activity_log l
    left join public.posts p on p.post_id = l.post_id
   where l.subject_user_id = v_uid
   order by l.occurred_at desc, l.log_id desc
   limit v_lim;
end;
$$;

comment on function public.rpc_my_activity_timeline(int) is
  'FR-STATS-003 (0044, 0742): the caller''s own activity timeline, newest first, with the world of each post''s listing (null for a social or deleted post).';

revoke all on function public.rpc_my_activity_timeline(int) from public, anon;
grant execute on function public.rpc_my_activity_timeline(int) to authenticated;
