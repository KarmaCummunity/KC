-- 0370_volunteer_schema | Time world — opportunities, shifts, signups (KC native).

begin;

alter table public.users
  add column if not exists volunteer_hours_total numeric(10, 2) not null default 0;

create table public.volunteer_opportunities (
  opportunity_id uuid primary key default gen_random_uuid(),
  organizer_id   uuid not null references public.users(user_id) on delete cascade,
  org_id           uuid references public.organizations(org_id) on delete set null,
  title            text not null,
  summary          text,
  location_label   text,
  city_id          text,
  status           text not null default 'draft'
    check (status in ('draft','open','closed','cancelled')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.volunteer_shifts (
  shift_id        uuid primary key default gen_random_uuid(),
  opportunity_id  uuid not null references public.volunteer_opportunities(opportunity_id) on delete cascade,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  capacity        int not null default 10 check (capacity >= 1 and capacity <= 500),
  created_at      timestamptz not null default now(),
  constraint volunteer_shifts_time_order check (ends_at > starts_at)
);

create table public.volunteer_shift_signups (
  signup_id          uuid primary key default gen_random_uuid(),
  shift_id           uuid not null references public.volunteer_shifts(shift_id) on delete cascade,
  user_id            uuid not null references public.users(user_id) on delete cascade,
  status             text not null default 'registered'
    check (status in ('registered','waitlisted','checked_in','cancelled','no_show')),
  waitlist_position  int,
  signed_up_at       timestamptz not null default now(),
  checked_in_at      timestamptz,
  hours_logged       numeric(8, 2),
  constraint volunteer_shift_signups_unique unique (shift_id, user_id)
);

create index volunteer_opportunities_status_idx on public.volunteer_opportunities (status, created_at desc);
create index volunteer_opportunities_organizer_idx on public.volunteer_opportunities (organizer_id);
create index volunteer_opportunities_org_idx on public.volunteer_opportunities (org_id) where org_id is not null;
create index volunteer_shifts_starts_idx on public.volunteer_shifts (starts_at);
create index volunteer_shifts_opportunity_idx on public.volunteer_shifts (opportunity_id);
create index volunteer_signups_user_idx on public.volunteer_shift_signups (user_id, signed_up_at desc);
create index volunteer_signups_shift_idx on public.volunteer_shift_signups (shift_id);

create trigger volunteer_opportunities_set_updated_at
  before update on public.volunteer_opportunities
  for each row execute function public.set_updated_at();

alter table public.volunteer_opportunities enable row level security;
alter table public.volunteer_shifts enable row level security;
alter table public.volunteer_shift_signups enable row level security;

create policy volunteer_opportunities_read_open on public.volunteer_opportunities
  for select to authenticated
  using (status = 'open' or organizer_id = (select auth.uid()));

create policy volunteer_opportunities_organizer_write on public.volunteer_opportunities
  for all to authenticated
  using (organizer_id = (select auth.uid()))
  with check (organizer_id = (select auth.uid()));

create policy volunteer_shifts_read on public.volunteer_shifts
  for select to authenticated using (true);

create policy volunteer_shifts_organizer_write on public.volunteer_shifts
  for all to authenticated
  using (
    exists (
      select 1 from public.volunteer_opportunities o
       where o.opportunity_id = volunteer_shifts.opportunity_id
         and o.organizer_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.volunteer_opportunities o
       where o.opportunity_id = volunteer_shifts.opportunity_id
         and o.organizer_id = (select auth.uid())
    )
  );

-- single SELECT policy (avoid dual permissive) — self or organizer
create policy volunteer_signups_read on public.volunteer_shift_signups
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.volunteer_shifts s
      join public.volunteer_opportunities o on o.opportunity_id = s.opportunity_id
       where s.shift_id = volunteer_shift_signups.shift_id
         and o.organizer_id = (select auth.uid())
    )
  );

commit;
