-- 0247_entity_resolution | Issue #833

begin;

create table public.marketplace_actors (
  actor_id      uuid primary key default gen_random_uuid(),
  actor_type    text not null check (actor_type in ('person','organization')),
  display_name  text not null,
  user_id       uuid references public.users(user_id) on delete set null,
  listing_id    uuid references public.listings(listing_id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint marketplace_actors_one_link check (
    (user_id is not null)::int + (listing_id is not null)::int <= 1
  )
);

create table public.entity_aliases (
  alias_id      uuid primary key default gen_random_uuid(),
  actor_id      uuid not null references public.marketplace_actors(actor_id) on delete cascade,
  alias_text    text not null,
  source        text,
  created_at    timestamptz not null default now(),
  constraint entity_aliases_unique unique (actor_id, alias_text)
);

create table public.er_candidates (
  candidate_id  uuid primary key default gen_random_uuid(),
  actor_a       uuid not null references public.marketplace_actors(actor_id) on delete cascade,
  actor_b       uuid not null references public.marketplace_actors(actor_id) on delete cascade,
  score         numeric(5, 4) not null check (score >= 0 and score <= 1),
  reason        text,
  status        text not null default 'open'
    check (status in ('open','merged','dismissed')),
  created_at    timestamptz not null default now(),
  constraint er_candidates_ordered check (actor_a::text < actor_b::text)
);

create table public.entity_merges (
  merge_id      uuid primary key default gen_random_uuid(),
  survivor_id   uuid not null references public.marketplace_actors(actor_id),
  merged_id     uuid not null references public.marketplace_actors(actor_id),
  snapshot      jsonb not null,
  merged_by     uuid references public.users(user_id),
  merged_at     timestamptz not null default now(),
  undone_at     timestamptz,
  undone_by     uuid references public.users(user_id)
);

alter table public.marketplace_actors enable row level security;
alter table public.entity_aliases enable row level security;
alter table public.er_candidates enable row level security;
alter table public.entity_merges enable row level security;

create policy marketplace_actors_select on public.marketplace_actors
  for select to authenticated using (true);

create policy entity_aliases_select on public.entity_aliases
  for select to authenticated using (true);

create policy er_candidates_operator on public.er_candidates
  for select to authenticated using (public.is_listing_operator(auth.uid()));

create policy entity_merges_operator on public.entity_merges
  for select to authenticated using (public.is_listing_operator(auth.uid()));

create or replace function public.merge_entities(p_survivor uuid, p_merged uuid, p_actor uuid default auth.uid())
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_merge_id uuid;
  v_snapshot jsonb;
begin
  if not public.is_listing_operator(p_actor) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'survivor', row_to_json(s.*),
    'merged', row_to_json(m.*),
    'aliases', (select jsonb_agg(row_to_json(a.*)) from public.entity_aliases a where a.actor_id = p_merged)
  )
  into v_snapshot
  from public.marketplace_actors s, public.marketplace_actors m
  where s.actor_id = p_survivor and m.actor_id = p_merged;

  update public.entity_aliases set actor_id = p_survivor where actor_id = p_merged;
  update public.marketplace_actors set user_id = coalesce(
    (select user_id from public.marketplace_actors where actor_id = p_survivor),
    (select user_id from public.marketplace_actors where actor_id = p_merged)
  ) where actor_id = p_survivor;

  insert into public.entity_merges (survivor_id, merged_id, snapshot, merged_by)
  values (p_survivor, p_merged, v_snapshot, p_actor)
  returning merge_id into v_merge_id;

  delete from public.marketplace_actors where actor_id = p_merged;

  update public.er_candidates set status = 'merged'
   where status = 'open' and (actor_a = p_merged or actor_b = p_merged);

  return v_merge_id;
end;
$$;

create or replace function public.undo_merge(p_merge_id uuid, p_actor uuid default auth.uid())
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_listing_operator(p_actor) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.entity_merges
     set undone_at = now(), undone_by = p_actor
   where merge_id = p_merge_id and undone_at is null;

  if not found then
    raise exception 'merge_not_found' using errcode = 'P0002';
  end if;
  -- Full actor restoration from snapshot is operator-runbook follow-up.
end;
$$;

grant execute on function public.merge_entities(uuid, uuid, uuid) to authenticated;
grant execute on function public.undo_merge(uuid, uuid) to authenticated;

commit;
