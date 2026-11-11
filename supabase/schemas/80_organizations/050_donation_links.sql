-- Organizations · community donation links (FR-DONATE-007/009, D9, D36)
--
-- Any member may suggest a link to an organization's own donation or volunteering page;
-- it goes live after a moderator approves it (D9). Rows are written by the
-- `validate-donation-link` Edge Function (service role) after it checked that the address
-- is reachable; a device only reads, reports and deletes. Editing the content of a link
-- sends it back to review.

-- The lists a link can belong to (one per giving world that shows links). Reference data:
-- the rows are loaded from supabase/seed, labels live in the app's locale files.
create table public.donation_link_categories (
  slug       text primary key check (slug ~ '^[a-z][a-z0-9_]{1,30}$'),
  icon_name  text not null,
  sort_order integer not null,
  is_active  boolean not null default true
);
comment on table public.donation_link_categories is 'Lists of community donation links, one per giving world.';

alter table public.donation_link_categories enable row level security;
alter table public.donation_link_categories force row level security;
create policy donation_link_categories_select on public.donation_link_categories
  for select to authenticated
  using (true);
grant select on public.donation_link_categories to authenticated;

insert into kc_private.fsm_state (machine_id, status) values
  ('donation_link_review', 'pending'), ('donation_link_review', 'approved'), ('donation_link_review', 'rejected');
insert into kc_private.fsm_edge (machine_id, from_status, to_status, role) values
  ('donation_link_review', 'pending', 'approved', 'reviewer'),
  ('donation_link_review', 'pending', 'rejected', 'reviewer'),
  -- An edited link returns to the queue, whoever edits it.
  ('donation_link_review', 'approved', 'pending', ''),
  ('donation_link_review', 'rejected', 'pending', '');

create table public.donation_links (
  id            uuid primary key default gen_random_uuid(),
  category_slug text not null references public.donation_link_categories (slug) on update cascade,
  url           text not null check (url ~* '^https?://' and char_length(url) <= 2000),
  display_name  text not null check (char_length(display_name) between 2 and 80),
  description   text check (char_length(description) <= 280),
  -- Null for the links the team curated as seed content (supabase/seed/content); a member's
  -- suggestion always names them and leaves with their account.
  submitted_by  uuid references public.users (id) on delete cascade,
  -- When the Edge Function last confirmed that the address answers.
  validated_at  timestamptz not null,
  -- Review, machine `donation_link_review`.
  review_status text not null default 'pending',
  reviewed_by   uuid references public.users (id) on delete set null,
  reviewed_at   timestamptz,
  -- Why the link was not approved; shown to its submitter.
  review_note   text check (char_length(review_note) <= 280),
  -- Search document; `simple` keeps Hebrew tokens unstemmed.
  search_vector tsvector generated always as (
                  to_tsvector('simple', display_name || ' ' || coalesce(description, ''))) stored,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.donation_links is 'Community-suggested links to organizations; visible to others once approved.';

-- The list of one giving world: approved links, newest first.
create index donation_links_category_idx on public.donation_links (category_slug, created_at desc, id desc)
  where review_status = 'approved';
-- "My links" and the hourly submission limit of the Edge Function; covers the submitter foreign key.
create index donation_links_submitted_by_idx on public.donation_links (submitted_by, created_at desc);
-- Review queue: by status, oldest first.
create index donation_links_review_queue_idx on public.donation_links (review_status, created_at, id)
  where review_status <> 'approved';
-- Universal search over approved links.
create index donation_links_search_gin_idx on public.donation_links using gin (search_vector)
  where review_status = 'approved';
create index donation_links_reviewed_by_idx on public.donation_links (reviewed_by) where reviewed_by is not null;

-- A new link always starts in the queue, and a change of its content returns it there
-- with the previous decision cleared. Runs before the machine guard (trigger name order).
create function kc_private.donation_links_requeue()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT'
     or (new.url, new.display_name, new.description, new.category_slug)
        is distinct from (old.url, old.display_name, old.description, old.category_slug) then
    new.review_status := 'pending';
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.review_note := null;
  end if;
  return new;
end;
$$;

create trigger donation_links_a_requeue
  before insert or update on public.donation_links
  for each row execute function kc_private.donation_links_requeue();
create trigger donation_links_review_fsm
  before insert or update on public.donation_links
  for each row execute function kc_private.fsm_guard_status('donation_link_review', 'review_status');
create trigger donation_links_set_updated_at
  before update on public.donation_links
  for each row execute function kc_private.set_updated_at();

alter table public.donation_links enable row level security;
alter table public.donation_links force row level security;

-- Members see approved links; the submitter also sees their own with its status
-- (FR-DONATE-007 AC1); moderators see the queue.
create policy donation_links_select on public.donation_links
  for select to authenticated
  using (review_status = 'approved'
         or submitted_by = (select auth.uid())
         or (select kc_access.has_admin_role('moderator')));
-- The submitter or the super admin removes a link for good (FR-DONATE-009 AC4/AC5).
create policy donation_links_delete on public.donation_links
  for delete to authenticated
  using (submitted_by = (select auth.uid()) or (select kc_access.has_admin_role('super_admin')));

grant select, delete on public.donation_links to authenticated;
-- The Edge Function adds and edits links after validating the address.
grant select, insert, update on public.donation_links to service_role;

-- Approves or rejects a link waiting in the queue (D9: super admin, admin or moderator).
-- Returns the new status. Errors: forbidden (42501); P0001 donation_link_not_pending.
create function public.admin_review_donation_link(p_link_id uuid, p_approve boolean, p_note text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_admin_role('moderator');
  v_status constant text := case when p_approve then 'approved' else 'rejected' end;
begin
  perform set_config('kc.fsm_role', 'reviewer', true);
  update public.donation_links l
     set review_status = v_status, reviewed_by = v_actor, reviewed_at = now(),
         review_note = case when p_approve then null else nullif(btrim(p_note), '') end
   where l.id = p_link_id and l.review_status = 'pending';
  if not found then
    raise exception 'donation_link_not_pending' using errcode = 'P0001';
  end if;
  perform set_config('kc.fsm_role', '', true);
  perform kc_private.audit_record('donation_link_review', 'donation_link', p_link_id,
                                  jsonb_build_object('decision', v_status));
  return v_status;
end;
$$;
comment on function public.admin_review_donation_link(uuid, boolean, text) is
  'Moderator: approves or rejects a pending donation link.';
grant execute on function public.admin_review_donation_link(uuid, boolean, text) to authenticated;

-- Reports a link to the support team (FR-DONATE-009 AC2): a system line in the caller's
-- support thread naming the link. Errors: unauthenticated (42501); P0001 donation_link_not_found.
create function public.report_donation_link(p_link_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_caller();
  v_url text;
begin
  select l.url into v_url
    from public.donation_links l
   where l.id = p_link_id and (l.review_status = 'approved' or l.submitted_by = v_user_id);
  if not found then
    raise exception 'donation_link_not_found' using errcode = 'P0001';
  end if;
  perform kc_private.chat_post_system_message(
    (public.open_support_thread()).id,
    jsonb_build_object('kind', 'donation_link_reported', 'donation_link_id', p_link_id, 'url', v_url));
end;
$$;
comment on function public.report_donation_link(uuid) is
  'Reports a donation link: writes a system message into the caller''s support thread.';
grant execute on function public.report_donation_link(uuid) to authenticated;
