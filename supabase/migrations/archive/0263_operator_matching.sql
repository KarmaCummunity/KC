-- 0263_operator_matching | Issue #847
-- Operator Matching queue, profile enrichments, level-1 auto-enqueue, operator RLS.

begin;

create table public.profile_enrichments (
  user_id      uuid primary key references public.users(user_id) on delete cascade,
  enrichments  jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now()
);

create trigger profile_enrichments_set_updated_at
  before update on public.profile_enrichments
  for each row execute function public.set_updated_at();

alter table public.profile_enrichments enable row level security;

create policy profile_enrichments_own on public.profile_enrichments
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create table public.operator_cases (
  case_id              uuid primary key default gen_random_uuid(),
  listing_id           uuid not null unique references public.listings(listing_id) on delete cascade,
  status               text not null default 'open'
    check (status in ('open','assigned','resolved','cancelled')),
  assigned_operator_id uuid references public.users(user_id) on delete set null,
  priority             smallint not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index operator_cases_status_idx on public.operator_cases (status, created_at desc);

create trigger operator_cases_set_updated_at
  before update on public.operator_cases
  for each row execute function public.set_updated_at();

create table public.operator_case_events (
  event_id    uuid primary key default gen_random_uuid(),
  case_id     uuid not null references public.operator_cases(case_id) on delete cascade,
  actor_id    uuid references public.users(user_id) on delete set null,
  event_type  text not null,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index operator_case_events_case_idx on public.operator_case_events (case_id, created_at);

revoke update, delete on public.operator_case_events from authenticated, anon;

create or replace function public.is_listing_operator(p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_viewer is not null and (
    public.has_admin_role(p_viewer, 'operator')
    or public.has_admin_role(p_viewer, 'operators_manager')
    or public.has_admin_role(p_viewer, 'support')
    or public.has_admin_role(p_viewer, 'moderator')
    or public.has_admin_role(p_viewer, 'super_admin')
  );
$$;

create or replace function public.operator_case_enqueue_for_listing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_case_id uuid;
begin
  if new.anonymity_level <> 1 then
    return new;
  end if;
  if new.moderation_status not in ('published', 'pending_review') then
    return new;
  end if;

  insert into public.operator_cases (listing_id, status)
  values (new.listing_id, 'open')
  on conflict (listing_id) do nothing
  returning case_id into v_case_id;

  if v_case_id is not null then
    insert into public.operator_case_events (case_id, actor_id, event_type, payload)
    values (
      v_case_id,
      new.owner_id,
      'case_opened',
      jsonb_build_object('anonymity_level', new.anonymity_level, 'world_slug', new.world_slug)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists listings_operator_case_enqueue on public.listings;
create trigger listings_operator_case_enqueue
  after insert or update of anonymity_level, moderation_status on public.listings
  for each row execute function public.operator_case_enqueue_for_listing();

comment on column public.listings.anonymity_level is
  'PRD V2 §3.3: 1=operators-only (OnlyMe), 2=followers, 3=public. Raise-only after publish.';

alter table public.operator_cases enable row level security;
alter table public.operator_case_events enable row level security;

create policy operator_cases_operator_all on public.operator_cases
  for all to authenticated
  using (public.is_listing_operator(auth.uid()))
  with check (public.is_listing_operator(auth.uid()));

create policy operator_cases_owner_read on public.operator_cases
  for select to authenticated
  using (
    exists (
      select 1 from public.listings l
       where l.listing_id = operator_cases.listing_id and l.owner_id = auth.uid()
    )
  );

create policy operator_case_events_operator_read on public.operator_case_events
  for select to authenticated
  using (
    public.is_listing_operator(auth.uid())
    or exists (
      select 1 from public.operator_cases c
      join public.listings l on l.listing_id = c.listing_id
       where c.case_id = operator_case_events.case_id and l.owner_id = auth.uid()
    )
  );

create policy operator_case_events_operator_insert on public.operator_case_events
  for insert to authenticated
  with check (public.is_listing_operator(auth.uid()));

grant select on public.operator_cases to authenticated;
grant select, insert on public.operator_case_events to authenticated;

commit;
