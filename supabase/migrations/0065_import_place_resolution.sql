-- External post import: resolve free place words from a shared post to the official catalog
-- (FR-IMPORT-004, ADR-008). The extractor returns place text as written ("in Tel Aviv", the
-- abbreviation of Tel Aviv, a street name); this file maps it to cities, streets and road
-- junctions (D71) and never to free text. Hebrew literals are written as Unicode escapes.

create extension if not exists pg_trgm with schema extensions;

-- Hebrew place text with the noise of casual writing removed: niqqud and cantillation, quote and
-- apostrophe marks (the abbreviation marks of "Tel Aviv" and the like), dashes (the official
-- name "Tel Aviv - Yafo" carries one) and other punctuation, then single spaces. Immutable so a
-- caller may index it; it is applied to the query and to every catalog name before comparing.
create function public.import_normalize_place_text(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select btrim(regexp_replace(
           regexp_replace(
             regexp_replace(lower(coalesce(p_text, '')), '[\u0591-\u05C7]', '', 'g'),
             '[''"\u05F3\u05F4\u2018\u2019\u201C\u201D`.,()]', '', 'g'),
           '[\s\-\u2013\u2014\u05BE]+', ' ', 'g'));
$$;
comment on function public.import_normalize_place_text(text) is
  'Place text without niqqud, quotes, dashes and punctuation, single-spaced; used to compare shared post text with the official place catalog (FR-IMPORT-004).';

-- Common short forms people write for a city. The canonical value is a normalized query that
-- the matcher then resolves against the catalog by name, so no city code is hard-coded here.
-- Grown from production corrections (G45); read-only for members.
create table public.place_import_aliases (
  alias_norm     text not null check (alias_norm = public.import_normalize_place_text(alias_norm) and alias_norm <> ''),
  level          text not null check (level in ('city', 'street', 'junction')),
  canonical_norm text not null check (canonical_norm = public.import_normalize_place_text(canonical_norm) and canonical_norm <> ''),
  primary key (level, alias_norm)
);
comment on table public.place_import_aliases is
  'Short forms and nicknames of official places mapped to a normalized name to resolve (FR-IMPORT-004 AC5).';

alter table public.place_import_aliases enable row level security;
alter table public.place_import_aliases force row level security;
create policy place_import_aliases_select_member on public.place_import_aliases
  for select to authenticated
  using (true);
grant select on public.place_import_aliases to authenticated;

insert into public.place_import_aliases (alias_norm, level, canonical_norm)
select public.import_normalize_place_text(a), l, public.import_normalize_place_text(c)
  from (values
  (U&'\05EA\05D0', 'city', U&'\05EA\05DC \05D0\05D1\05D9\05D1'),  -- Tel Aviv-Yafo
  (U&'\05D1\05E9', 'city', U&'\05D1\05D0\05E8 \05E9\05D1\05E2'),  -- Beer Sheva
  (U&'\05E4\05EA', 'city', U&'\05E4\05EA\05D7 \05EA\05E7\05D5\05D5\05D4'),  -- Petah Tikva
  (U&'\05E8\05D0\05E9\05DC\05E6', 'city', U&'\05E8\05D0\05E9\05D5\05DF \05DC\05E6\05D9\05D5\05DF'),  -- Rishon LeZion
  (U&'\05E8\05DE\05D2', 'city', U&'\05E8\05DE\05EA \05D2\05DF')  -- Ramat Gan
  ) as v (a, l, c);

-- Up to p_limit official places of one level whose name resembles the words of a shared post,
-- best first. `score` is 0..1 (1 = same name after normalizing; a query contained in a longer
-- official name scores at most 0.9); `margin` is the lead over the next row, so a caller can
-- tell a clear winner from a tie. Floors and the "auto-pick or suggest" decision belong to the
-- caller (city 0.85, street 0.80, junction 0.80, margin 0.10 in FR-IMPORT-004). A street needs
-- its city. Rows below 0.5 are not worth suggesting and are not returned.
-- A leading Hebrew prefix letter (in / to / from / the / that / and / like) is tried both kept
-- and removed, so "in Haifa" finds Haifa while a name that starts with such a letter still wins.
-- Runs with the caller's rights: the catalogs' own policies apply.
create function public.api_resolve_place(
  p_level text,
  p_text text,
  p_city_id text default null,
  p_limit integer default 3
)
returns table (place_id text, name_he text, city_id text, score real, margin real)
language plpgsql
stable
set search_path = ''
as $$
declare
  c_prefix constant text := U&'\05D4\05D1\05DC\05DE\05E9\05D5\05DB';
  v_q0 text := public.import_normalize_place_text(p_text);
  v_q1 text;
  v_q2 text;
begin
  if p_level is null or p_level not in ('city', 'street', 'junction') then
    raise exception 'place_level_invalid' using errcode = '22023';
  end if;
  if char_length(v_q0) not between 2 and 80 then
    raise exception 'place_query_invalid' using errcode = '22023';
  end if;
  if p_level = 'street' and (p_city_id is null or btrim(p_city_id) = '') then
    raise exception 'place_city_required' using errcode = '22023';
  end if;
  if p_limit is null or p_limit not between 1 and 5 then
    raise exception 'place_limit_invalid' using errcode = '22023';
  end if;

  -- The query as written, then with one and with two leading prefix letters removed.
  if char_length(v_q0) >= 5 and position(left(v_q0, 1) in c_prefix) > 0 then
    v_q1 := substr(v_q0, 2);
    if char_length(v_q1) >= 5 and position(left(v_q1, 1) in c_prefix) > 0 then
      v_q2 := substr(v_q1, 2);
    end if;
  end if;

  return query
  with variants as (
    select coalesce(
             (select a.canonical_norm from public.place_import_aliases a
               where a.level = p_level and a.alias_norm = v.q),
             v.q) as q
      from (select distinct x as q from unnest(array[v_q0, v_q1, v_q2]) as x where x is not null) v
  ),
  candidates as (
    select c.city_id as cand_id, c.name_he as cand_name, c.city_id as cand_city,
           public.import_normalize_place_text(c.name_he) as norm
      from public.cities c
     where p_level = 'city'
    union all
    select s.street_id::text, s.name_he, s.city_id, public.import_normalize_place_text(s.name_he)
      from public.streets s
     where p_level = 'street' and s.city_id = p_city_id
    union all
    select j.junction_id::text, j.name_he, null::text, public.import_normalize_place_text(j.name_he)
      from public.road_junctions j
     where p_level = 'junction'
  ),
  scored as (
    select k.cand_id, k.cand_name, k.cand_city,
           (select max(greatest(extensions.similarity(k.norm, v.q),
                                0.9 * extensions.word_similarity(v.q, k.norm)))
              from variants v)::numeric(4, 3)::real as sc
      from candidates k
  ),
  ranked as (
    select s.cand_id, s.cand_name, s.cand_city, s.sc,
           -- Total order, so equal scores always come back in the same sequence.
           row_number() over (order by s.sc desc, s.cand_name, s.cand_id) as rn
      from scored s
     where s.sc >= 0.5
  )
  select r.cand_id, r.cand_name, r.cand_city, r.sc,
         round((r.sc - coalesce(lead(r.sc) over (order by r.rn), 0))::numeric, 2)::real
    from ranked r
   order by r.rn
   limit p_limit;
end;
$$;
comment on function public.api_resolve_place(text, text, text, integer) is
  'Resolve place words from a shared post to official cities, streets or junctions with a score and a lead margin (FR-IMPORT-004).';

revoke all on function public.api_resolve_place(text, text, text, integer) from public;
grant execute on function public.api_resolve_place(text, text, text, integer) to authenticated, service_role;
