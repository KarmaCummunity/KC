-- 0656 — drop legacy join_challenge(uuid) overload; profile link must not roll back join.

set search_path = public;

drop function if exists public.join_challenge(uuid);

create or replace function public.join_challenge(
  p_challenge_id uuid,
  p_show_on_profile boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_c public.challenges%rowtype;
  v_surface text;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '28000'; end if;
  select * into v_c from public.challenges where challenge_id = p_challenge_id;
  if not found
     or v_c.scope <> 'community'
     or public.is_blocked(v_uid, v_c.creator_id) then
    raise exception 'challenge_not_found' using errcode = 'P0002';
  end if;
  if v_c.status <> 'active' then raise exception 'challenge_not_active' using errcode = '23514'; end if;
  if v_c.ends_at is not null and v_c.ends_at <= now() then
    raise exception 'challenge_ended' using errcode = '23514';
  end if;
  begin
    insert into public.challenge_participations (challenge_id, user_id) values (p_challenge_id, v_uid);
  exception when unique_violation then
    raise exception 'already_joined' using errcode = '23505';
  end;

  if v_c.post_id is not null then
    v_surface := case when coalesce(p_show_on_profile, true) then 'Public' else 'OnlyMe' end;
    begin
      insert into public.post_actor_identity (
        post_id, user_id, surface_visibility, identity_visibility, hide_from_counterparty
      ) values (
        v_c.post_id, v_uid, v_surface, 'Public', false
      )
      on conflict (post_id, user_id) do update set
        surface_visibility = excluded.surface_visibility,
        identity_visibility = 'Public',
        hide_from_counterparty = false;
    exception
      when others then
        raise warning 'challenge_join_profile_link_failed challenge=% post=%: %',
          p_challenge_id, v_c.post_id, sqlerrm;
    end;
  end if;
end;
$$;

revoke all on function public.join_challenge(uuid, boolean) from public;
grant execute on function public.join_challenge(uuid, boolean) to authenticated;

-- ── leave_challenge: drop profile link on leave ─────────────────────────────

create or replace function public.leave_challenge(p_challenge_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_creator uuid;
  v_post_id uuid;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '28000'; end if;
  select c.creator_id, c.post_id into v_creator, v_post_id
    from public.challenges c where c.challenge_id = p_challenge_id;
  if not found then raise exception 'challenge_not_found' using errcode = 'P0002'; end if;
  if v_creator = v_uid then raise exception 'creator_cannot_leave' using errcode = '23514'; end if;
  delete from public.challenge_participations where challenge_id = p_challenge_id and user_id = v_uid;
  if not found then raise exception 'not_participant' using errcode = 'P0002'; end if;
  delete from public.challenge_progress_entries where challenge_id = p_challenge_id and user_id = v_uid;
  if v_post_id is not null then
    delete from public.post_actor_identity where post_id = v_post_id and user_id = v_uid;
  end if;
end;
$$;

-- ── upsert_post_actor_identity: challenge participants ────────────────────────

create or replace function public.upsert_post_actor_identity(
  p_post_id uuid,
  p_surface_visibility text,
  p_hide_from_counterparty boolean
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if p_surface_visibility not in ('Public', 'FollowersOnly', 'OnlyMe') then
    raise exception 'invalid_surface_visibility' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.posts p where p.post_id = p_post_id and p.owner_id = v_user_id
  )
  and not exists (
    select 1 from public.recipients r
    where r.post_id = p_post_id and r.recipient_user_id = v_user_id
  )
  and not exists (
    select 1
      from public.challenge_participations cp
      join public.challenges c on c.challenge_id = cp.challenge_id
     where c.post_id = p_post_id and cp.user_id = v_user_id
  ) then
    raise exception 'forbidden_not_participant' using errcode = '42501';
  end if;

  insert into public.post_actor_identity (
    post_id, user_id, surface_visibility, identity_visibility, hide_from_counterparty
  )
  values (
    p_post_id, v_user_id, p_surface_visibility, 'Public', p_hide_from_counterparty
  )
  on conflict (post_id, user_id) do update set
    surface_visibility = excluded.surface_visibility,
    identity_visibility = excluded.identity_visibility,
    hide_from_counterparty = excluded.hide_from_counterparty;
end;
$$;

-- ── profile open tab: challenge posts the member joined ─────────────────────

create or replace function public.profile_open_challenge_post_ids(
  p_profile_user_id uuid,
  p_viewer_user_id uuid,
  p_list_mode text default 'standard'
)
returns setof uuid
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_list_mode not in ('standard', 'owner_only_me') then
    raise exception 'invalid_list_mode' using errcode = '22023';
  end if;

  if p_list_mode = 'owner_only_me'
     and p_viewer_user_id is distinct from p_profile_user_id then
    return;
  end if;

  return query
  select p.post_id
    from public.challenge_participations cp
    join public.challenges c on c.challenge_id = cp.challenge_id
    join public.posts p on p.post_id = c.post_id
    left join public.post_actor_identity pai
      on pai.post_id = p.post_id and pai.user_id = cp.user_id
   where cp.user_id = p_profile_user_id
     and c.post_id is not null
     and p.status = 'open'
     and p.feed_hidden = false
     and case coalesce(pai.surface_visibility, 'Public')
       when 'OnlyMe' then p_list_mode = 'owner_only_me' and p_viewer_user_id = p_profile_user_id
       else p_list_mode = 'standard'
            and (
              p_viewer_user_id = p_profile_user_id
              or public.participant_closed_surface_visible(p, cp.user_id, p_viewer_user_id)
            )
     end;
end;
$$;

revoke all on function public.profile_open_challenge_post_ids(uuid, uuid, text) from public;
grant execute on function public.profile_open_challenge_post_ids(uuid, uuid, text) to authenticated;

comment on function public.join_challenge(uuid, boolean) is
  'Join a community challenge; links post_actor_identity on the challenge post (Public vs OnlyMe on profile).';
comment on function public.profile_open_challenge_post_ids(uuid, uuid, text) is
  'Challenge post ids for a profile open tab (standard vs hidden OnlyMe links).';
