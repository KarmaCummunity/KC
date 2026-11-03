-- 0546_donation_link_approval | D9 (docs/spec/08_organizations.md: "Any user may suggest a link;
-- it goes live after admin approval"), PM decision 2026-11-03 to implement it now.
--
-- A donation link is suggested by any member (validate-donation-link Edge Function, unchanged)
-- and shown to others only once a reviewer (super admin or moderator) approves it:
--   review_status  pending → approved | rejected, set by the reviewer RPC only
--   review_note    the reviewer's optional reason, shown to the submitter on rejection
-- The submitter keeps seeing their own link while it waits, so the list can say so.
-- Editing an approved link's content (url, name, description, category) sends it back to
-- review, so an approved link cannot be swapped for another address.
-- Links that were live before this migration stay live: they are backfilled as approved.

begin;

-- ── columns ──────────────────────────────────────────────────────────────────
alter table public.donation_links
  add column if not exists review_status text not null default 'pending',
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_note text;

alter table public.donation_links
  drop constraint if exists donation_links_review_status_check;
alter table public.donation_links
  add constraint donation_links_review_status_check
  check (review_status in ('pending', 'approved', 'rejected'));
alter table public.donation_links
  drop constraint if exists donation_links_review_note_length;
alter table public.donation_links
  add constraint donation_links_review_note_length
  check (review_note is null or char_length(review_note) <= 280);

-- Everything visible today stays visible (no directory outage on deploy).
update public.donation_links
   set review_status = 'approved', reviewed_at = coalesce(validated_at, created_at)
 where review_status = 'pending';

create index if not exists donation_links_review_queue_idx
  on public.donation_links (review_status, created_at)
  where review_status = 'pending';

-- ── who reviews ──────────────────────────────────────────────────────────────
-- Mirrors the 'donation_links.review' row of the app's PERMISSION_MATRIX.
create or replace function public.is_donation_link_reviewer(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_uid is not null
     and (public.has_admin_role(p_uid, 'super_admin') or public.has_admin_role(p_uid, 'moderator'));
$$;

revoke all on function public.is_donation_link_reviewer(uuid) from public, anon;
grant execute on function public.is_donation_link_reviewer(uuid) to authenticated;

-- ── guard: only the reviewer RPC sets the review; content edits go back to review ──
-- SECURITY INVOKER on purpose: current_user is then the writer's role. A client
-- (authenticated) or the Edge Function (service_role) cannot touch the review columns; the
-- reviewer RPC below is SECURITY DEFINER, so its update runs as the table owner and may.
create or replace function public.donation_links_review_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- A new suggestion always waits for review, whoever inserts it.
    new.review_status := 'pending';
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.review_note := null;
    return new;
  end if;
  -- Review columns change only inside admin_review_donation_link (runs as the table owner).
  if (new.review_status, new.reviewed_by, new.reviewed_at, new.review_note)
       is distinct from (old.review_status, old.reviewed_by, old.reviewed_at, old.review_note)
     and current_user in ('anon', 'authenticated', 'service_role') then
    raise exception 'donation_link_review_forbidden' using errcode = '42501';
  end if;
  -- New content needs a new review.
  if (new.url, new.display_name, new.description, new.category_slug)
       is distinct from (old.url, old.display_name, old.description, old.category_slug) then
    new.review_status := 'pending';
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.review_note := null;
  end if;
  return new;
end;
$$;

revoke all on function public.donation_links_review_guard() from public, anon, authenticated;

drop trigger if exists donation_links_review_guard on public.donation_links;
create trigger donation_links_review_guard
  before insert or update on public.donation_links
  for each row execute function public.donation_links_review_guard();

-- ── visibility: approved to everyone signed in; own and reviewers see the rest ──
drop policy if exists donation_links_select_visible on public.donation_links;
create policy donation_links_select_visible on public.donation_links
  for select to authenticated using (
    (hidden_at is null and review_status = 'approved')
    or submitted_by = (select auth.uid())
    or public.is_donation_link_reviewer((select auth.uid()))
  );

-- ── reviewer RPCs ────────────────────────────────────────────────────────────
-- The review queue (or the decided ones), oldest first, with the submitter's name.
create or replace function public.admin_list_donation_links_for_review(p_status text default 'pending')
returns table (
  id             uuid,
  category_slug  text,
  url            text,
  display_name   text,
  description    text,
  submitted_by   uuid,
  submitter_name text,
  review_status  text,
  review_note    text,
  created_at     timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_donation_link_reviewer(auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status not in ('pending', 'approved', 'rejected') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  return query
  select l.id, l.category_slug, l.url, l.display_name, l.description, l.submitted_by,
         u.display_name, l.review_status, l.review_note, l.created_at
    from public.donation_links l
    left join public.users u on u.user_id = l.submitted_by
   where l.review_status = p_status
     and l.hidden_at is null
   order by l.created_at asc
   limit 200;
end;
$$;

revoke all on function public.admin_list_donation_links_for_review(text) from public, anon;
grant execute on function public.admin_list_donation_links_for_review(text) to authenticated;

-- Approve or reject one pending link; a rejection may carry a short note for the submitter.
create or replace function public.admin_review_donation_link(
  p_link_id uuid,
  p_approve boolean,
  p_note text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text := case when p_approve then 'approved' else 'rejected' end;
  v_updated integer;
begin
  if not public.is_donation_link_reviewer(auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.donation_links
     set review_status = v_status,
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         review_note = case when p_approve then null else nullif(trim(p_note), '') end
   where id = p_link_id
     and review_status = 'pending'
     and hidden_at is null;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'donation_link_not_pending' using errcode = 'P0002';
  end if;
  return v_status;
end;
$$;

revoke all on function public.admin_review_donation_link(uuid, boolean, text) from public, anon;
grant execute on function public.admin_review_donation_link(uuid, boolean, text) to authenticated;

commit;
