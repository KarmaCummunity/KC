-- External post import · the cross-post guard (FR-IMPORT-008 AC1, KC#2438).
--
-- A member who imports a message they already published in KC is told "you already have this
-- post", with a link. The extraction function compares the extracted title and description with
-- the member's own open posts by trigram similarity (pg_trgm), and a match of 0.80 or more is
-- returned with the draft. Publishing anyway is allowed (a deliberate repost) and stays marked on
-- the import record (`duplicate_post_id`).

-- The member's open post the import repeats, when the extraction function found one.
alter table public.external_post_imports
  add column duplicate_post_id uuid references public.posts (id) on delete set null;
comment on column public.external_post_imports.duplicate_post_id is
  'The member''s open post this import repeats (similarity >= 0.80), shown as a warning (FR-IMPORT-008 AC1).';
-- Covers the foreign key (set null when that post is removed).
create index external_post_imports_duplicate_idx
  on public.external_post_imports (duplicate_post_id) where duplicate_post_id is not null;

-- The member's open post most similar to the text, when it reaches p_min (0..1). Title and
-- description are compared as one lower-cased text, the way the extraction returns them.
create function public.import_similar_open_post(p_user_id uuid, p_text text, p_min real default 0.8)
returns table (post_id uuid, similarity real)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.score
    from (
      select p.id,
             extensions.similarity(lower(coalesce(p.title, '') || ' ' || coalesce(p.description, '')), lower(p_text)) as score
        from public.posts p
       where p.owner_id = p_user_id and p.status = 'open'
    ) s
   where s.score >= p_min
   order by s.score desc, s.id
   limit 1;
$$;
comment on function public.import_similar_open_post(uuid, text, real) is
  'The member''s open post most similar to an imported text, at or above p_min (FR-IMPORT-008 AC1); service role only.';

-- Only the extraction function (service role) reads it.
revoke all on function public.import_similar_open_post(uuid, text, real) from public, anon, authenticated;
grant execute on function public.import_similar_open_post(uuid, text, real) to service_role;
