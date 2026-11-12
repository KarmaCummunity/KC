-- 0208_content_translations — FR-TRANSLATE-002 (cache core).
-- Demand-driven translation cache. Service-role writes only; self-cleans on
-- source delete / moderation. See design §4, §7, §8.

create table if not exists public.content_translations (
  id uuid primary key default gen_random_uuid(),
  content_type text not null,
  content_id uuid not null,
  field text not null,
  target_language text not null,
  source_language text,
  translated_text text not null,
  model text,
  confidence real,
  created_at timestamptz not null default now()
);

comment on table public.content_translations is
  'Demand-driven translation cache for UGC (posts/messages). One row per (content_type, content_id, target_language, field). Populated by the translate pipeline (Phase 1b). Service-role writes only.';
comment on column public.content_translations.content_id is
  'Polymorphic FK (no constraint) into posts.post_id or messages.message_id depending on content_type. Cleaned by BEFORE DELETE / moderation triggers.';
comment on column public.content_translations.created_at is
  'Basis for chat-translation age eviction (Phase 3). No last_read_at by design (avoids read-path write amplification).';

alter table public.content_translations drop constraint if exists content_translations_type_chk;
alter table public.content_translations
  add constraint content_translations_type_chk check (content_type in ('post','message'));

alter table public.content_translations drop constraint if exists content_translations_field_chk;
alter table public.content_translations
  add constraint content_translations_field_chk check (field in ('title','description','body'));

alter table public.content_translations drop constraint if exists content_translations_conf_chk;
alter table public.content_translations
  add constraint content_translations_conf_chk check (confidence is null or confidence between 0 and 1);

-- Single-flight + per-content prefix lookup. Order matters: content first.
create unique index if not exists content_translations_key_uidx
  on public.content_translations (content_type, content_id, target_language, field);

-- Grants: service-role only mutations. authenticated may read (reads are further
-- gated by RLS — a narrow SELECT policy lands in Phase 1c with the read RPC).
revoke all on public.content_translations from anon, authenticated;
grant select on public.content_translations to authenticated;

alter table public.content_translations enable row level security;
-- Deny-by-default for authenticated: an explicit `using (false)` SELECT policy
-- keeps direct reads blocked until Phase 1c (which replaces it with a narrow
-- policy backing the SECURITY INVOKER read RPC, joined to the already-RLS'd
-- source row). Service role bypasses RLS for the translate pipeline writes.
-- (A policy is required even when deny-by-default — RLS-lint enforces >=1 policy.)
drop policy if exists content_translations_no_direct_read on public.content_translations;
create policy content_translations_no_direct_read
  on public.content_translations
  for select
  to authenticated
  using (false);

-- Purge translations when the source post is deleted.
create or replace function public.content_translations_purge_post()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.content_translations
   where content_type = 'post' and content_id = old.post_id;
  return old;
end;
$$;

drop trigger if exists trg_content_translations_purge_post on public.posts;
create trigger trg_content_translations_purge_post
  before delete on public.posts
  for each row execute function public.content_translations_purge_post();

-- Purge translations when the source message is deleted.
create or replace function public.content_translations_purge_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.content_translations
   where content_type = 'message' and content_id = old.message_id;
  return old;
end;
$$;

drop trigger if exists trg_content_translations_purge_message on public.messages;
create trigger trg_content_translations_purge_message
  before delete on public.messages
  for each row execute function public.content_translations_purge_message();

-- Purge translations when a post is moderated/removed (status flips to the
-- admin-removed state) so no readable translated copy of removed content survives.
create or replace function public.content_translations_purge_post_on_remove()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status
     and new.status = 'removed_admin' then
    delete from public.content_translations
     where content_type = 'post' and content_id = new.post_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_content_translations_purge_post_remove on public.posts;
create trigger trg_content_translations_purge_post_remove
  after update of status on public.posts
  for each row execute function public.content_translations_purge_post_on_remove();
