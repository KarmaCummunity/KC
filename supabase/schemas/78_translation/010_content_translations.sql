-- Translation · cache of translated user content (FR-TRANSLATE-002/003, docs/SSOT/UGC_TRANSLATION.md)
--
-- A text is translated only when a reader asks for it in a language, by the `translate`
-- Edge Function, and the result is kept here: one row per content, field and target
-- language. The function writes with the service role; a concurrent second writer of the
-- same key loses on the primary key (single flight). The cache never outlives its source:
-- an edit or a removal of the source row purges its translations.

create table public.content_translations (
  -- What was translated. The id is the source row's id; there is no foreign key because
  -- the source is one of four tables — the triggers below keep the cache in step.
  content_type    text not null check (content_type in ('post', 'comment', 'message', 'user')),
  content_id      uuid not null,
  field           text not null check (field in ('title', 'description', 'body', 'biography')),
  -- BCP 47 tag the text was translated into.
  target_language text not null check (char_length(target_language) between 2 and 35),
  source_language text check (char_length(source_language) between 2 and 35),
  translated_text text not null check (char_length(translated_text) between 1 and 8000),
  -- Provider model that produced the text.
  model           text check (char_length(model) between 1 and 100),
  confidence      real check (confidence between 0 and 1),
  created_at      timestamptz not null default now(),
  -- The cache key; its prefix serves the purge of one source row and the batched read.
  primary key (content_type, content_id, field, target_language),
  -- Each kind of content has its own translatable fields.
  constraint content_translations_field_chk check (case content_type
    when 'post' then field in ('title', 'description')
    when 'user' then field = 'biography'
    else field = 'body' end)
);
comment on table public.content_translations is
  'Demand-driven cache of translated posts, comments, messages and biographies. Written by the service role.';

alter table public.content_translations enable row level security;
alter table public.content_translations force row level security;

-- A translation is readable exactly when its source row is: each subquery runs under the
-- caller's own access to the source table (audience, blocks, moderation). One policy per
-- kind of content. Message translations have no policy: chat translation is opt-in per
-- sender and not released yet (FR-TRANSLATE-004), so they are readable by nobody.
create policy content_translations_select_post on public.content_translations
  for select to authenticated
  using (content_type = 'post'
         and exists (select 1 from public.posts p where p.id = content_translations.content_id));
create policy content_translations_select_comment on public.content_translations
  for select to authenticated
  using (content_type = 'comment'
         and exists (select 1 from public.post_comments c
                      where c.id = content_translations.content_id and c.status = 'active'));
create policy content_translations_select_user on public.content_translations
  for select to authenticated
  using (content_type = 'user'
         and exists (select 1 from public.users u where u.id = content_translations.content_id));

grant select on public.content_translations to authenticated;
-- The translate function reads, inserts and (to replace a bad row) deletes.
grant select, insert, delete on public.content_translations to service_role;

-- Removes the cached translations of the source row. The content type is the trigger's
-- argument; the row's id is `id` in all four source tables.
create function kc_private.content_translations_purge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.content_translations t
   where t.content_type = tg_argv[0] and t.content_id = old.id;
  return null;
end;
$$;
comment on function kc_private.content_translations_purge() is
  'AFTER trigger on a source table: drops the cached translations of an edited or removed row.';

-- Posts: an edit of the text (FR-TRANSLATE-003 AC10), a removal by moderation and the
-- deletion of the row (FR-TRANSLATE-002 AC3). The condition keeps ordinary writes free.
create trigger posts_purge_translations_on_edit
  after update of title, description, status on public.posts
  for each row
  when (new.title is distinct from old.title or new.description is distinct from old.description
        or (new.status = 'removed_admin' and old.status <> 'removed_admin'))
  execute function kc_private.content_translations_purge('post');
create trigger posts_purge_translations_on_delete
  after delete on public.posts
  for each row execute function kc_private.content_translations_purge('post');

-- Comments: an edit of the body, any move out of `active`, and the deletion of the row.
create trigger post_comments_purge_translations_on_edit
  after update of body, status on public.post_comments
  for each row
  when (new.body is distinct from old.body or (new.status <> 'active' and old.status = 'active'))
  execute function kc_private.content_translations_purge('comment');
create trigger post_comments_purge_translations_on_delete
  after delete on public.post_comments
  for each row execute function kc_private.content_translations_purge('comment');

-- Messages are immutable, so only their deletion purges.
create trigger messages_purge_translations_on_delete
  after delete on public.messages
  for each row execute function kc_private.content_translations_purge('message');

-- Biographies: an edit, and the removal of the member.
create trigger users_purge_translations_on_edit
  after update of biography on public.users
  for each row
  when (new.biography is distinct from old.biography)
  execute function kc_private.content_translations_purge('user');
create trigger users_purge_translations_on_delete
  after delete on public.users
  for each row execute function kc_private.content_translations_purge('user');

-- Cached translations of the listed posts in one language, in one round trip (cache hits
-- only; a missing row means "not translated yet"). Runs with the caller's rights: the
-- policy above leaves out every post the caller cannot read. At most 100 posts.
create function public.get_post_translations(p_post_ids uuid[], p_target_language text)
returns table (
  post_id uuid, field text, translated_text text, source_language text, confidence real)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.content_id, t.field, t.translated_text, t.source_language, t.confidence
    from public.content_translations t
   where t.content_type = 'post'
     and t.content_id = any (p_post_ids[1:100])
     and t.target_language = p_target_language;
$$;
comment on function public.get_post_translations(uuid[], text) is
  'Cached translations of posts the caller can read, for one target language.';
grant execute on function public.get_post_translations(uuid[], text) to authenticated;
