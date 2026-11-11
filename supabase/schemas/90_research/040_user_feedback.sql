-- Research · free feedback (FR-SETTINGS-017, FR-ADMIN-021 AC5)
--
-- Settings → "Free feedback": an optional 1–7 rating and a short text, sent by a signed-in
-- member and read by staff on the admin survey dashboard. A member inserts their own row
-- and never reads it back; staff read the list, newest first, through one RPC that adds the
-- sender's display name.

create table public.user_feedback (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade,
  rating     integer check (rating between 1 and 7),
  body       text not null check (char_length(btrim(body)) between 10 and 500),
  created_at timestamptz not null default now()
);
comment on table public.user_feedback is 'Free feedback from Settings: optional 1-7 rating and text. Read by staff only.';

-- Staff list, newest first, keyset on (created_at, id).
create index user_feedback_recent_idx on public.user_feedback (created_at desc, id desc);
-- Covers the member foreign key (account removal).
create index user_feedback_user_idx on public.user_feedback (user_id);

alter table public.user_feedback enable row level security;
alter table public.user_feedback force row level security;

-- An active member files feedback as themselves. There is no select policy: the list is
-- staff-only and served by admin_user_feedback_list().
create policy user_feedback_insert_own on public.user_feedback
  for insert to authenticated
  with check (user_id = (select auth.uid())
              and exists (select 1 from public.users u where u.id = (select auth.uid()) and u.is_active));

grant insert (user_id, rating, body) on public.user_feedback to authenticated;

-- One keyset page of free feedback for the admin dashboard, newest first, with the sender's
-- display name (FR-ADMIN-021 AC5). Moderators and more senior staff only (AC1, AC6). Pass
-- the last row's next_cursor to continue.
--   forbidden (42501)
create function public.admin_user_feedback_list(p_limit integer default 50, p_cursor jsonb default null)
returns table (
  id uuid, user_id uuid, display_name text, rating integer, body text, created_at timestamptz,
  next_cursor jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit constant integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_t constant timestamptz := (p_cursor ->> 't')::timestamptz;
  v_id constant uuid := (p_cursor ->> 'id')::uuid;
begin
  perform kc_private.require_admin_role('moderator');
  return query
  select f.id, f.user_id, u.display_name, f.rating, f.body, f.created_at,
         jsonb_build_object('t', f.created_at, 'id', f.id)
    from public.user_feedback f
    join public.users u on u.id = f.user_id
   where p_cursor is null or (f.created_at, f.id) < (v_t, v_id)
   order by f.created_at desc, f.id desc
   limit v_limit;
end;
$$;
comment on function public.admin_user_feedback_list(integer, jsonb) is
  'Staff: one keyset page of free feedback, newest first, with the sender''s display name.';
grant execute on function public.admin_user_feedback_list(integer, jsonb) to authenticated;
