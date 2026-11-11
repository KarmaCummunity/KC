-- Social · text-match candidates for search
--
-- The read functions of this module run with the caller's rights, so that RLS decides what
-- is visible. Under RLS the planner may only push leak-proof conditions into an index scan,
-- and text matching (ILIKE, @@) is not leak-proof: asked directly, a text search would
-- check the visibility of every row before it could use the trigram or full-text index.
--
-- These two functions do the index part with definer rights and return candidate ids only:
-- the newest (or most followed) matches, capped. The caller then reads those ids through
-- its own access, so visibility is still decided by RLS and by nothing else. They live in
-- `kc_access`, which a device cannot address, so the ids never leave the database unfiltered.

-- The text as an ILIKE pattern that matches it literally anywhere.
create function kc_private.contains_pattern(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select '%' || replace(replace(replace(p_text, '\', '\\'), '%', '\%'), '_', '\_') || '%';
$$;
comment on function kc_private.contains_pattern(text) is 'ILIKE pattern matching the given text literally, anywhere.';

-- Up to 500 newest open posts whose title or description contains the text (served by
-- posts_text_trgm_idx from three characters up), and, when asked, up to 500 newest
-- delivered posts likewise.
create function kc_access.post_ids_matching_text(p_query text, p_include_closed boolean default false)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select array(
    (select p.id from public.posts p
      where p.status = 'open'
        and (p.title || ' ' || coalesce(p.description, '')) ilike kc_private.contains_pattern(p_query)
      order by p.published_at desc
      limit 500)
    union all
    (select p.id from public.posts p
      where p_include_closed and p.status = 'closed_delivered'
        and (p.title || ' ' || coalesce(p.description, '')) ilike kc_private.contains_pattern(p_query)
      order by p.published_at desc
      limit 500));
$$;
comment on function kc_access.post_ids_matching_text(text, boolean) is
  'Candidate ids for post search: newest posts containing the text. The caller re-reads them under RLS.';
grant execute on function kc_access.post_ids_matching_text(text, boolean) to authenticated;

-- Up to 500 most followed active members whose display name contains the text
-- (users_display_name_trgm_idx) or whose name or handle has it as a whole word
-- (users_search_gin_idx).
create function kc_access.user_ids_matching_text(p_query text)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select array(
    select u.id
      from public.users u
      join public.user_stats s on s.user_id = u.id
     where u.is_active
       and (u.display_name ilike kc_private.contains_pattern(p_query)
            or u.search_vector @@ plainto_tsquery('simple', p_query))
     order by s.followers_count desc, u.id desc
     limit 500);
$$;
comment on function kc_access.user_ids_matching_text(text) is
  'Candidate ids for member search: most followed active members matching the text. The caller re-reads them under RLS.';
grant execute on function kc_access.user_ids_matching_text(text) to authenticated;
