-- Social · the owner-only `mine` tab of profile_posts_page (FR-POST-016)
--
-- "My listings" reads the caller's own posts in every status and audience through the
-- profile tab RPC instead of selecting from posts and hydrating the ids with post_cards.
-- The function gains a fifth parameter (p_statuses); a second overload would make the
-- four-argument calls ambiguous, so the baseline version is dropped and the function is
-- created again with its comment and grant.
drop function public.profile_posts_page(uuid, jsonb, integer, text);

-- One tab of a profile's posts, newest first (FR-PROFILE-001 AC4, FR-PROFILE-002):
--   open     open posts shown on the profile (never "only me")
--   closed   delivered posts; on one's own profile also posts deleted without a recipient,
--            which can still be reopened
--   hidden   the owner's "only me" posts — RLS returns them to nobody else
--   mine     the caller's own posts in every status and audience (drafts, paused, expired,
--            closed, under moderation): "my listings" (FR-POST-016); p_statuses narrows it
--            to the listed statuses. Only for one's own profile (forbidden, SQLSTATE 42501).
-- RLS narrows every tab to what the caller may read of that member. Keyset on
-- (created_at, id), served by posts_owner_recent_idx.
create function public.profile_posts_page(
  p_user_id uuid,
  p_cursor jsonb default null,
  p_limit integer default 20,
  p_tab text default 'open',
  p_statuses text[] default null
)
returns table (card public.post_card, next_cursor jsonb)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_post_ids uuid[];
begin
  if p_tab is null or p_tab not in ('open', 'closed', 'hidden', 'mine') then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  if p_tab = 'mine' and p_user_id is distinct from (select auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_post_ids := array(
    select p.id
      from public.posts p
     where p.owner_id = p_user_id
       and case p_tab
             when 'open' then p.status = 'open' and p.visibility <> 'OnlyMe'
             when 'closed' then p.status in ('closed_delivered', 'deleted_no_recipient')
                                and p.visibility <> 'OnlyMe'
             when 'hidden' then p.status in ('open', 'closed_delivered') and p.visibility = 'OnlyMe'
             else p_statuses is null or p.status = any (p_statuses) end
       and (p_cursor is null
            or (p.created_at, p.id) < ((p_cursor ->> 't')::timestamptz, (p_cursor ->> 'id')::uuid))
     order by p.created_at desc, p.id desc
     limit least(greatest(coalesce(p_limit, 20), 1), 50));

  return query
  select c, jsonb_build_object('t', c.created_at, 'id', c.id)
    from public.post_cards(v_post_ids) c
   order by c.created_at desc, c.id desc;
end;
$$;
comment on function public.profile_posts_page(uuid, jsonb, integer, text, text[]) is
  'One keyset page of a tab of a member''s posts (open, closed, hidden; mine for the owner), as cards.';
grant execute on function public.profile_posts_page(uuid, jsonb, integer, text, text[]) to authenticated;
