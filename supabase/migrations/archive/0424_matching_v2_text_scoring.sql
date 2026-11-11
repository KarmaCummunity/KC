-- 0424_matching_v2_text_scoring | Matching v2: Hebrew-aware title understanding (no LLM).
--
-- Replaces the trigram-only text signal that let same-category but different objects match
-- (books <-> bookshelf, stroller <-> crib). Titles are tokenized with:
--   * normalisation: lower case, final letters folded (kaf/mem/nun/pe/tsadi sofit), "[e2e ...]"
--     run tags and gender slashes ("/t", "/h") dropped, stop words removed (HE + EN);
--   * stems per token: up to two one-letter Hebrew prefixes (vav, he, bet, lamed, mem, shin,
--     kaf) when >= 3 letters remain, plural/construct suffixes (-im, -ot, -i, -a, -t), EN plural -s.
-- Head noun: Hebrew titles put the head first ("shelf of books" = head "shelf"); English titles
-- put it last before a preposition ("Grey sofa for my flat" = "sofa"). "or" / "," split a title
-- into alternative heads ("sofa or armchair").
--   head      1    an offer head = a request head
--             0.5  a request head appears elsewhere in the offer (title or summary)
--             0.25 the offer head only appears as a modifier of the request (books vs book SHELF)
--   overlap   share of offer title tokens found in the request title (stem-aware)
--   text      0.55*head + 0.30*overlap + 0.15*trigram (near-identical trigram wins)
-- Weights move from category-only towards text; notify needs text >= notify_min_text (rides exempt).

begin;

alter table public.matching_settings
  add column if not exists notify_min_text numeric(5, 4) not null default 0.5000
    check (notify_min_text between 0 and 1);

update public.matching_settings
   set weights = weights
     || jsonb_build_object(
          'default',   jsonb_build_object('category', 0.15, 'geo', 0.25, 'time', 0.10, 'text', 0.30, 'trust', 0.10, 'feedback', 0.10),
          'knowledge', jsonb_build_object('category', 0.30, 'geo', 0.05, 'time', 0.10, 'text', 0.35, 'trust', 0.15, 'feedback', 0.05),
          'time',      jsonb_build_object('category', 0.20, 'geo', 0.20, 'time', 0.25, 'text', 0.20, 'trust', 0.10, 'feedback', 0.05)
        ),
       updated_at = now()
 where id;

create or replace function public.match_text_norm(p text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $$
  select translate(
           replace(replace(regexp_replace(lower(coalesce(p, '')), '\[e2e[^]]*\]', ' ', 'g'), U&'/\05EA', ''), U&'/\05D4', ''),
           U&'\05DA\05DD\05DF\05E3\05E5', U&'\05DB\05DE\05E0\05E4\05E6');
$$;

create or replace function public.match_text_stopwords()
returns text[]
language sql
immutable
parallel safe
as $$
  select array[U&'\05D0\05D5',U&'\05D0\05D9\05E0',U&'\05D0\05E0\05D9',U&'\05D0\05EA',U&'\05D1\05D1\05E7\05E9\05D4',U&'\05D1\05D7\05D9\05E0\05DE',U&'\05D1\05DE\05E6\05D1',U&'\05D2\05DE',U&'\05D3\05D7\05D5\05E4',U&'\05D3\05E8\05D5\05E9',U&'\05D3\05E8\05D5\05E9\05D4',U&'\05D3\05E8\05D5\05E9\05D9\05DE',U&'\05D4\05E9\05D0\05DC\05D4',U&'\05D6\05D0\05EA',U&'\05D6\05D4',U&'\05D6\05D5',U&'\05D7\05D3\05E9',U&'\05D7\05D3\05E9\05D4',U&'\05D7\05D3\05E9\05D9\05DE',U&'\05D7\05D9\05E0\05DE',U&'\05D8\05D5\05D1',U&'\05D8\05D5\05D1\05D4',U&'\05D9\05E9',U&'\05DB\05DC',U&'\05DB\05DE\05D5',U&'\05DB\05DE\05E2\05D8',U&'\05DC\05D4\05E9\05D0\05D9\05DC',U&'\05DC\05D9',U&'\05DC\05DE\05E1\05D9\05E8\05D4',U&'\05DC\05E0\05D5',U&'\05DE\05D0\05D5\05D3',U&'\05DE\05D1\05E7\05E9',U&'\05DE\05D1\05E7\05E9\05EA',U&'\05DE\05D5\05E1\05E8',U&'\05DE\05D5\05E1\05E8\05D9\05DE',U&'\05DE\05D5\05E1\05E8\05EA',U&'\05DE\05D7\05E4\05E9',U&'\05DE\05D7\05E4\05E9\05D5\05EA',U&'\05DE\05D7\05E4\05E9\05D9\05DE',U&'\05DE\05D7\05E4\05E9\05EA',U&'\05DE\05DE\05E9',U&'\05DE\05E6\05D1',U&'\05E0\05D5\05EA\05E0',U&'\05E0\05D5\05EA\05E0\05EA',U&'\05E2\05D3',U&'\05E2\05D5\05D3',U&'\05E2\05DC',U&'\05E2\05DE',U&'\05E6\05E8\05D9\05DB',U&'\05E6\05E8\05D9\05DB\05D4',U&'\05E6\05E8\05D9\05DB\05D9\05DE',U&'\05E9\05DC',U&'\05E9\05DC\05D9',U&'\05E9\05DC\05E0\05D5',U&'\05EA\05D5\05D3\05D4', 'a','an','and','any','e2e','for','free','give','giving','good','in','looking','me','my','need','needed','needs','new','of','offer','offering','on','or','please','request','some','the','to','used','want','wanted','with']::text[];
$$;

-- Content tokens in title order (normalised, stop words / pure numbers / 1-letter dropped).
create or replace function public.match_text_tokens(p text)
returns text[]
language sql
immutable
parallel safe
set search_path = public
as $$
  select coalesce(array_agg(t.tok order by t.ord), '{}')
    from regexp_split_to_table(public.match_text_norm(p), '[^0-9a-z' || U&'\05D0' || '-' || U&'\05EA' || ']+')
         with ordinality as t(tok, ord)
   where char_length(t.tok) >= 2
     and t.tok !~ '^[0-9]+$'
     and not (t.tok = any (public.match_text_stopwords()));
$$;

-- Head nouns: one per "or" / "," alternative. Hebrew: first content token; Latin: last content
-- token before the first preposition that leaves content.
create or replace function public.match_text_heads(p text)
returns text[]
language plpgsql
immutable
parallel safe
set search_path = public
as $$
declare
  seg   text;
  sub   text;
  toks  text[];
  heads text[] := '{}';
begin
  foreach seg in array regexp_split_to_array(public.match_text_norm(p), '\s+(' || U&'\05D0\05D5' || '|or)\s+|[,;|]') loop
    toks := public.match_text_tokens(seg);
    continue when coalesce(array_length(toks, 1), 0) = 0;
    if toks[1] ~ '^[a-z]' then
      foreach sub in array regexp_split_to_array(seg, '\m(for|with|from|to|in|near|at)\M') loop
        toks := public.match_text_tokens(sub);
        if coalesce(array_length(toks, 1), 0) > 0 then
          heads := heads || toks[array_length(toks, 1)];
          exit;
        end if;
      end loop;
    else
      heads := heads || toks[1];
    end if;
  end loop;
  return heads;
end;
$$;

-- Stem variants of one normalised token (prefix letters, plural / construct suffixes).
create or replace function public.match_token_stems(p text)
returns text[]
language plpgsql
immutable
parallel safe
as $$
declare
  pre   constant text := U&'\05D5\05D4\05D1\05DC\05DE\05E9\05DB';
  bases text[];
  res   text[] := '{}';
  b     text;
  n     integer;
begin
  if p is null or p = '' then
    return res;
  end if;
  p := translate(lower(p), U&'\05DA\05DD\05DF\05E3\05E5', U&'\05DB\05DE\05E0\05E4\05E6');
  bases := array[p];
  n := char_length(p);
  if n - 1 >= 3 and position(left(p, 1) in pre) > 0 then
    bases := bases || substr(p, 2);
    if n - 2 >= 3 and position(substr(p, 2, 1) in pre) > 0 then
      bases := bases || substr(p, 3);
    end if;
  end if;
  foreach b in array bases loop
    n := char_length(b);
    res := res || b;
    if n - 2 >= 2 and right(b, 2) in (U&'\05D9\05DE', U&'\05D5\05EA') then
      res := res || left(b, n - 2);
    end if;
    if n >= 4 and right(b, 1) in (U&'\05D9', U&'\05EA') then
      res := res || left(b, n - 1);
    end if;
    if n >= 3 and right(b, 1) in (U&'\05D4', U&'\05D0') then
      res := res || left(b, n - 1);
    end if;
    if b ~ '^[a-z]{4,}$' then
      if right(b, 2) = 'es' then
        res := res || left(b, n - 2);
      end if;
      if right(b, 1) = 's' then
        res := res || left(b, n - 1);
      end if;
    end if;
  end loop;
  return res;
end;
$$;

create or replace function public.match_token_in(p_tok text, p_list text[])
returns boolean
language sql
immutable
parallel safe
set search_path = public
as $$
  select exists (
    select 1 from unnest(coalesce(p_list, '{}')) y
     where public.match_token_stems(p_tok) && public.match_token_stems(y)
  );
$$;

create or replace function public.match_text_score(
  p_offer_title text, p_offer_summary text, p_request_title text, p_request_summary text
)
returns jsonb
language plpgsql
stable
parallel safe
set search_path = public, extensions
as $$
declare
  a      text[] := public.match_text_tokens(p_offer_title);
  b      text[] := public.match_text_tokens(p_request_title);
  osum   text[] := public.match_text_tokens(p_offer_summary);
  oh     text[] := public.match_text_heads(p_offer_title);
  rh     text[] := public.match_text_heads(p_request_title);
  v_trgm numeric;
  v_head numeric := 0;
  v_ov   numeric := 0;
  v_text numeric;
  v_hit  integer;
  x      text;
begin
  v_trgm := greatest(
    similarity(lower(coalesce(p_offer_title, '')), lower(coalesce(p_request_title, ''))),
    word_similarity(lower(coalesce(p_request_title, '')), lower(coalesce(p_offer_title, '') || ' ' || coalesce(p_offer_summary, ''))),
    word_similarity(lower(coalesce(p_offer_title, '')), lower(coalesce(p_request_title, '') || ' ' || coalesce(p_request_summary, '')))
  );

  if coalesce(array_length(a, 1), 0) = 0 or coalesce(array_length(b, 1), 0) = 0 then
    return jsonb_build_object('head', 0, 'overlap', 0, 'trgm', round(v_trgm, 3), 'text', round(v_trgm, 3));
  end if;

  foreach x in array oh loop
    if public.match_token_in(x, rh) then
      v_head := 1;
      exit;
    end if;
  end loop;
  if v_head = 0 then
    foreach x in array rh loop
      if public.match_token_in(x, (select coalesce(array_agg(t), '{}') from unnest(a) t where not (t = any (oh))) || osum) then
        v_head := 0.5;
        exit;
      end if;
    end loop;
  end if;
  if v_head = 0 then
    foreach x in array oh loop
      if public.match_token_in(x, b) then
        v_head := 0.25;
        exit;
      end if;
    end loop;
  end if;

  select count(*) into v_hit from unnest(a) t where public.match_token_in(t, b);
  v_ov := least(1, v_hit::numeric / least(array_length(a, 1), array_length(b, 1)));

  v_text := 0.55 * v_head + 0.30 * v_ov + 0.15 * v_trgm;
  if v_trgm >= 0.8 then
    v_text := greatest(v_text, v_trgm);
  end if;
  return jsonb_build_object('head', v_head, 'overlap', round(v_ov, 3), 'trgm', round(v_trgm, 3),
                            'text', round(least(1, v_text), 3));
end;
$$;

comment on function public.match_text_score(text, text, text, text) is
  'Matching v2: Hebrew-aware head-noun / keyword overlap text score (0..1) with trigram fallback.';

revoke all on function public.match_text_norm(text) from public, anon, authenticated;
revoke all on function public.match_text_stopwords() from public, anon, authenticated;
revoke all on function public.match_text_tokens(text) from public, anon, authenticated;
revoke all on function public.match_text_heads(text) from public, anon, authenticated;
revoke all on function public.match_token_stems(text) from public, anon, authenticated;
revoke all on function public.match_token_in(text, text[]) from public, anon, authenticated;
revoke all on function public.match_text_score(text, text, text, text) from public, anon, authenticated;
grant execute on function public.match_text_score(text, text, text, text) to service_role;

commit;
