-- 0570_knowledge_topics | FR-KNOW-001 (docs/SSOT/spec/23_knowledge.md), D119, S64 — the subject
-- axis of the knowledge world (docs/spec/18_knowledge_world.md §18.3).
--
-- A curated topic tree with aliases, used by knowledge posts, resources, filters, "follow a
-- topic" and the agent API. The six D100 sub-categories stay the SHELF axis in
-- `public.categories`; the PRD subject rows that lived there (tech, languages, …) become
-- topics and are deactivated as shelves. Additive and idempotent: no row is deleted, no
-- column is dropped.
--
--   knowledge_topics         the tree (depth ≤ 4, no cycles, a merged topic keeps its slug)
--   knowledge_topic_aliases  Hebrew / English / transliteration spellings, unique when normalized
--   knowledge_topic_follows  "notify me about new offers and resources on this topic" (D10)
--   knowledge_normalize_text lower-case, niqqud stripped, final letters folded, punctuation out
--   resolve_knowledge_topics query terms → matched topics + their descendants (search, auto-suggest)
--   propose_knowledge_topic  any member proposes; used at once as `proposed`
--   review_knowledge_topic   operators approve / reject / rename / merge
--   add_knowledge_topic_alias, update_my_proposed_knowledge_topic
--
-- Linking topics to posts (knowledge_post_topics) ships with the knowledge create flow
-- (FR-KNOW-002), on `posts`, once G1-S2 makes posts the source of truth for every category.

begin;

-- ── 1. Text normalization ─────────────────────────────────────────────────────────────
-- Immutable so a generated column can use it. Keeps a–z, 0–9 and Hebrew letters; everything
-- else (punctuation, geresh, dashes) becomes a space, so "ג'אווה-סקריפט" and "ג אווה סקריפט"
-- compare equal. Final letters fold to their base form so "פייתון" and "פייתונ" match.
create or replace function public.knowledge_normalize_text(p text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select btrim(regexp_replace(
    regexp_replace(
      translate(
        regexp_replace(lower(coalesce(p, '')), '[' || U&'\0591' || '-' || U&'\05C7' || ']', '', 'g'),
        U&'\05DA\05DD\05DF\05E3\05E5', U&'\05DB\05DE\05E0\05E4\05E6'),
      '[^a-z0-9' || U&'\05D0' || '-' || U&'\05EA' || ']+', ' ', 'g'),
    '\s+', ' ', 'g'));
$$;

comment on function public.knowledge_normalize_text(text) is
  'FR-KNOW-001 AC4: normalization applied to topic labels, aliases and search terms.';

-- ── 2. Tables ─────────────────────────────────────────────────────────────────────────
create table if not exists public.knowledge_topics (
  topic_id             uuid primary key default gen_random_uuid(),
  slug                 text not null unique
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 64),
  parent_id            uuid references public.knowledge_topics(topic_id) on delete restrict,
  label_he             text not null check (char_length(label_he) between 1 and 80),
  label_en             text not null check (char_length(label_en) between 1 and 80),
  description_he       text check (description_he is null or char_length(description_he) <= 280),
  status               text not null default 'active'
    check (status in ('active', 'proposed', 'merged')),
  merged_into_id       uuid references public.knowledge_topics(topic_id) on delete restrict,
  -- The `public.categories` subject row this topic replaces (FR-KNOW-001 AC2); the
  -- FR-KNOW-002 data migration maps existing knowledge listings through it.
  legacy_category_slug text,
  sort_order           integer not null default 0,
  created_by           uuid references public.users(user_id) on delete set null,
  approved_by          uuid references public.users(user_id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint knowledge_topics_not_own_parent check (parent_id is null or parent_id <> topic_id),
  constraint knowledge_topics_merged_target check ((status = 'merged') = (merged_into_id is not null)),
  constraint knowledge_topics_not_merged_into_self check (merged_into_id is null or merged_into_id <> topic_id)
);

create index if not exists knowledge_topics_parent_idx
  on public.knowledge_topics (parent_id, sort_order);
create index if not exists knowledge_topics_status_idx
  on public.knowledge_topics (status);

create table if not exists public.knowledge_topic_aliases (
  alias_id   uuid primary key default gen_random_uuid(),
  topic_id   uuid not null references public.knowledge_topics(topic_id) on delete cascade,
  alias      text not null check (char_length(alias) between 1 and 80),
  alias_norm text generated always as (public.knowledge_normalize_text(alias)) stored,
  lang       text not null default 'he' check (lang in ('he', 'en', 'other')),
  created_at timestamptz not null default now(),
  constraint knowledge_topic_aliases_norm_not_empty check (public.knowledge_normalize_text(alias) <> '')
);

create unique index if not exists knowledge_topic_aliases_norm_uidx
  on public.knowledge_topic_aliases (alias_norm);
create index if not exists knowledge_topic_aliases_topic_idx
  on public.knowledge_topic_aliases (topic_id);

create table if not exists public.knowledge_topic_follows (
  user_id    uuid not null references public.users(user_id) on delete cascade,
  topic_id   uuid not null references public.knowledge_topics(topic_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, topic_id)
);

create index if not exists knowledge_topic_follows_topic_idx
  on public.knowledge_topic_follows (topic_id);

drop trigger if exists knowledge_topics_set_updated_at on public.knowledge_topics;
create trigger knowledge_topics_set_updated_at
  before update on public.knowledge_topics
  for each row execute function public.set_updated_at();

-- ── 3. Tree invariants: depth ≤ 4, no cycles, no merged parent ────────────────────────
-- Height of the subtree rooted at p_topic_id (1 = a leaf), so re-parenting a branch cannot
-- push its deepest descendant below the cap.
create or replace function public.knowledge_topic_subtree_height(p_topic_id uuid)
returns integer
language sql
stable
set search_path = public
as $$
  with recursive sub as (
    select topic_id, 1 as depth from knowledge_topics where topic_id = p_topic_id
    union all
    select t.topic_id, sub.depth + 1
      from knowledge_topics t
      join sub on t.parent_id = sub.topic_id
  )
  select coalesce(max(depth), 1) from sub;
$$;

create or replace function public.knowledge_topics_enforce_tree()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_depth  integer := 1;      -- depth of NEW once placed under its parent (root = 1)
  v_cursor uuid := new.parent_id;
  v_parent_status text;
  v_height integer := 1;
begin
  if new.parent_id is null then
    return new;
  end if;
  if new.parent_id = new.topic_id then
    raise exception 'knowledge_topic_cycle' using errcode = '23514';
  end if;

  select status into v_parent_status from knowledge_topics where topic_id = new.parent_id;
  if not found then
    raise exception 'knowledge_topic_parent_missing' using errcode = '23503';
  end if;
  if v_parent_status = 'merged' then
    raise exception 'knowledge_topic_parent_merged' using errcode = '23514';
  end if;

  -- Walk up to the root: a visit to NEW itself is a cycle; more than three ancestors is
  -- deeper than the cap (FR-KNOW-001 AC1).
  while v_cursor is not null loop
    if v_cursor = new.topic_id then
      raise exception 'knowledge_topic_cycle' using errcode = '23514';
    end if;
    v_depth := v_depth + 1;
    if v_depth > 4 then
      raise exception 'knowledge_topic_depth_exceeded' using errcode = '23514';
    end if;
    select parent_id into v_cursor from knowledge_topics where topic_id = v_cursor;
  end loop;

  if tg_op = 'UPDATE' then
    v_height := knowledge_topic_subtree_height(new.topic_id);
    if v_depth + v_height - 1 > 4 then
      raise exception 'knowledge_topic_depth_exceeded' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists knowledge_topics_enforce_tree on public.knowledge_topics;
create trigger knowledge_topics_enforce_tree
  before insert or update of parent_id on public.knowledge_topics
  for each row execute function public.knowledge_topics_enforce_tree();

-- ── 4. RLS: everyone reads the tree and its aliases; writes go through RPCs ───────────
alter table public.knowledge_topics enable row level security;
alter table public.knowledge_topic_aliases enable row level security;
alter table public.knowledge_topic_follows enable row level security;

drop policy if exists knowledge_topics_select_all on public.knowledge_topics;
create policy knowledge_topics_select_all on public.knowledge_topics
  for select to anon, authenticated using (true);

drop policy if exists knowledge_topic_aliases_select_all on public.knowledge_topic_aliases;
create policy knowledge_topic_aliases_select_all on public.knowledge_topic_aliases
  for select to anon, authenticated using (true);

-- A member manages only their own follows (FR-KNOW-008 AC5 reads them).
drop policy if exists knowledge_topic_follows_own_select on public.knowledge_topic_follows;
create policy knowledge_topic_follows_own_select on public.knowledge_topic_follows
  for select to authenticated using (user_id = auth.uid());
drop policy if exists knowledge_topic_follows_own_insert on public.knowledge_topic_follows;
create policy knowledge_topic_follows_own_insert on public.knowledge_topic_follows
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists knowledge_topic_follows_own_delete on public.knowledge_topic_follows;
create policy knowledge_topic_follows_own_delete on public.knowledge_topic_follows
  for delete to authenticated using (user_id = auth.uid());

-- ── 5. Resolution: query terms → topics + descendants (FR-KNOW-001 AC4) ───────────────
-- Candidates are the whole normalized text, every word and every adjacent word pair, so
-- "english conversation" matches the alias "english conversation" and the topic "english".
-- A merged topic's own slug and labels resolve to the topic it was merged into; its aliases
-- were moved at merge time. Descendants of a match are included (`via = 'descendant'`).
-- SECURITY INVOKER on purpose: the tree and its aliases are readable by every role through
-- RLS, and the 0520 guard keeps the anon-callable SECURITY DEFINER surface to a reviewed list.
create or replace function public.resolve_knowledge_topics(p_text text)
returns table (topic_id uuid, slug text, matched_slug text, via text)
language sql
stable
set search_path = ''
as $$
  with recursive
  q as (select public.knowledge_normalize_text(p_text) as qtext),
  tok as (
    select u.t, u.i
      from q, unnest(string_to_array(q.qtext, ' ')) with ordinality as u(t, i)
     where u.t <> ''
  ),
  cand as (
    select q.qtext as c from q where q.qtext <> ''
    union select tok.t from tok
    union select a.t || ' ' || b.t from tok a join tok b on b.i = a.i + 1
  ),
  direct as (
    select coalesce(t.merged_into_id, t.topic_id) as topic_id
      from public.knowledge_topics t
     where public.knowledge_normalize_text(replace(t.slug, '-', ' ')) in (select c from cand)
        or public.knowledge_normalize_text(t.label_he) in (select c from cand)
        or public.knowledge_normalize_text(t.label_en) in (select c from cand)
    union
    select a.topic_id
      from public.knowledge_topic_aliases a
     where a.alias_norm in (select c from cand)
  ),
  roots as (
    select t.topic_id, t.slug
      from public.knowledge_topics t
      join direct d on d.topic_id = t.topic_id
     where t.status in ('active', 'proposed')
  ),
  tree as (
    select r.topic_id, r.slug as matched_slug, 'self'::text as via from roots r
    union all
    select c.topic_id, tree.matched_slug, 'descendant'::text
      from public.knowledge_topics c
      join tree on c.parent_id = tree.topic_id
     where c.status in ('active', 'proposed')
  )
  select distinct on (tree.topic_id) tree.topic_id, t.slug, tree.matched_slug, tree.via
    from tree
    join public.knowledge_topics t on t.topic_id = tree.topic_id
   order by tree.topic_id, (tree.via = 'self') desc;
$$;

comment on function public.resolve_knowledge_topics(text) is
  'FR-KNOW-001 AC4: topics whose slug, label or alias matches a term of the text, plus their descendants.';

-- ── 6. Proposals (any member) ─────────────────────────────────────────────────────────
create or replace function public.propose_knowledge_topic(
  p_slug text,
  p_label_he text,
  p_label_en text,
  p_parent_slug text default null,
  p_description_he text default null
)
returns public.knowledge_topics
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_parent uuid;
  v_row public.knowledge_topics;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;
  if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(v_slug) > 64 then
    raise exception 'knowledge_topic_slug_invalid' using errcode = '22023';
  end if;
  -- A slug may not shadow an existing topic or an alias: both resolve searches.
  if exists (select 1 from knowledge_topics where slug = v_slug)
     or exists (select 1 from knowledge_topic_aliases
                 where alias_norm = knowledge_normalize_text(replace(v_slug, '-', ' '))) then
    raise exception 'knowledge_topic_slug_taken' using errcode = '23505';
  end if;
  if p_parent_slug is not null then
    select topic_id into v_parent from knowledge_topics
     where slug = p_parent_slug and status <> 'merged';
    if not found then
      raise exception 'knowledge_topic_parent_missing' using errcode = 'P0002';
    end if;
  end if;
  -- At most ten open proposals per member keeps the review queue honest.
  if (select count(*) from knowledge_topics where created_by = v_uid and status = 'proposed') >= 10 then
    raise exception 'knowledge_topic_proposal_limit' using errcode = 'P0001';
  end if;

  insert into knowledge_topics (slug, parent_id, label_he, label_en, description_he, status, created_by)
  values (v_slug, v_parent, btrim(p_label_he), btrim(p_label_en), nullif(btrim(p_description_he), ''),
          'proposed', v_uid)
  returning * into v_row;
  return v_row;
end;
$$;

-- The proposer may still edit labels while the topic waits for review (FR-KNOW-001 AC6).
create or replace function public.update_my_proposed_knowledge_topic(
  p_topic_id uuid,
  p_label_he text,
  p_label_en text,
  p_description_he text default null
)
returns public.knowledge_topics
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.knowledge_topics;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;
  update knowledge_topics
     set label_he = btrim(p_label_he),
         label_en = btrim(p_label_en),
         description_he = nullif(btrim(p_description_he), '')
   where topic_id = p_topic_id and created_by = v_uid and status = 'proposed'
  returning * into v_row;
  if not found then
    raise exception 'knowledge_topic_not_editable' using errcode = 'P0002';
  end if;
  return v_row;
end;
$$;

-- ── 7. Review (operators): approve / reject / rename / merge (FR-KNOW-001 AC5) ─────────
-- Aliases of a merged topic move to the target; its slug and labels become aliases of the
-- target so old links and searches keep resolving; its children and followers move too.
create or replace function public.knowledge_topic_merge(p_topic_id uuid, p_into uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from public.knowledge_topics;
begin
  select * into v_from from knowledge_topics where topic_id = p_topic_id for update;
  if exists (
    with recursive anc as (
      select topic_id, parent_id from knowledge_topics where topic_id = p_into
      union all
      select t.topic_id, t.parent_id from knowledge_topics t join anc on t.topic_id = anc.parent_id
    )
    select 1 from anc where topic_id = p_topic_id
  ) then
    raise exception 'knowledge_topic_merge_into_descendant' using errcode = '23514';
  end if;

  update knowledge_topics set parent_id = p_into where parent_id = p_topic_id;

  insert into knowledge_topic_follows (user_id, topic_id, created_at)
  select f.user_id, p_into, f.created_at from knowledge_topic_follows f where f.topic_id = p_topic_id
  on conflict (user_id, topic_id) do nothing;
  delete from knowledge_topic_follows where topic_id = p_topic_id;

  update knowledge_topic_aliases a
     set topic_id = p_into
   where a.topic_id = p_topic_id;

  insert into knowledge_topic_aliases (topic_id, alias, lang)
  select distinct on (knowledge_normalize_text(v.alias)) p_into, v.alias, v.lang
    from (values (replace(v_from.slug, '-', ' '), 'en'), (v_from.label_he, 'he'), (v_from.label_en, 'en')) as v(alias, lang)
   where knowledge_normalize_text(v.alias) <> ''
     and not exists (select 1 from knowledge_topic_aliases x where x.alias_norm = knowledge_normalize_text(v.alias));

  update knowledge_topics
     set status = 'merged', merged_into_id = p_into, approved_by = auth.uid()
   where topic_id = p_topic_id;
end;
$$;

create or replace function public.review_knowledge_topic(
  p_topic_id uuid,
  p_action text,
  p_merge_into_id uuid default null,
  p_label_he text default null,
  p_label_en text default null
)
returns public.knowledge_topics
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.knowledge_topics;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;
  if not is_listing_operator(v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_row from knowledge_topics where topic_id = p_topic_id for update;
  if not found then
    raise exception 'knowledge_topic_not_found' using errcode = 'P0002';
  end if;
  if v_row.status = 'merged' then
    raise exception 'knowledge_topic_already_merged' using errcode = '23514';
  end if;

  if p_action = 'approve' then
    update knowledge_topics set status = 'active', approved_by = v_uid
     where topic_id = p_topic_id returning * into v_row;
  elsif p_action = 'reject' then
    if v_row.status <> 'proposed' then
      raise exception 'knowledge_topic_not_proposed' using errcode = '23514';
    end if;
    if exists (select 1 from knowledge_topics where parent_id = p_topic_id) then
      raise exception 'knowledge_topic_has_children' using errcode = '23514';
    end if;
    delete from knowledge_topics where topic_id = p_topic_id;
  elsif p_action = 'rename' then
    update knowledge_topics
       set label_he = coalesce(nullif(btrim(p_label_he), ''), label_he),
           label_en = coalesce(nullif(btrim(p_label_en), ''), label_en)
     where topic_id = p_topic_id returning * into v_row;
  elsif p_action = 'merge' then
    if p_merge_into_id is null or p_merge_into_id = p_topic_id then
      raise exception 'knowledge_topic_merge_target_invalid' using errcode = '22023';
    end if;
    if not exists (select 1 from knowledge_topics where topic_id = p_merge_into_id and status = 'active') then
      raise exception 'knowledge_topic_merge_target_invalid' using errcode = '22023';
    end if;
    perform knowledge_topic_merge(p_topic_id, p_merge_into_id);
    select * into v_row from knowledge_topics where topic_id = p_topic_id;
  else
    raise exception 'knowledge_topic_action_invalid' using errcode = '22023';
  end if;
  return v_row;
end;
$$;

create or replace function public.add_knowledge_topic_alias(p_topic_id uuid, p_alias text, p_lang text default 'he')
returns public.knowledge_topic_aliases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.knowledge_topic_aliases;
begin
  if v_uid is null or not is_listing_operator(v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from knowledge_topics where topic_id = p_topic_id and status <> 'merged') then
    raise exception 'knowledge_topic_not_found' using errcode = 'P0002';
  end if;
  if exists (select 1 from knowledge_topic_aliases where alias_norm = knowledge_normalize_text(p_alias)) then
    raise exception 'knowledge_topic_alias_taken' using errcode = '23505';
  end if;
  insert into knowledge_topic_aliases (topic_id, alias, lang)
  values (p_topic_id, btrim(p_alias), p_lang)
  returning * into v_row;
  return v_row;
end;
$$;

-- ── 8. Privileges (0520: explicit per function) ───────────────────────────────────────
revoke all on function public.knowledge_normalize_text(text) from public;
grant execute on function public.knowledge_normalize_text(text) to anon, authenticated;
revoke all on function public.resolve_knowledge_topics(text) from public;
grant execute on function public.resolve_knowledge_topics(text) to anon, authenticated;
revoke all on function public.propose_knowledge_topic(text, text, text, text, text) from public, anon;
grant execute on function public.propose_knowledge_topic(text, text, text, text, text) to authenticated;
revoke all on function public.update_my_proposed_knowledge_topic(uuid, text, text, text) from public, anon;
grant execute on function public.update_my_proposed_knowledge_topic(uuid, text, text, text) to authenticated;
revoke all on function public.review_knowledge_topic(uuid, text, uuid, text, text) from public, anon;
grant execute on function public.review_knowledge_topic(uuid, text, uuid, text, text) to authenticated;
revoke all on function public.add_knowledge_topic_alias(uuid, text, text) from public, anon;
grant execute on function public.add_knowledge_topic_alias(uuid, text, text) to authenticated;
-- Internal helpers: triggers and the review RPC only.
revoke all on function public.knowledge_topic_subtree_height(uuid) from public, anon, authenticated;
revoke all on function public.knowledge_topics_enforce_tree() from public, anon, authenticated;
revoke all on function public.knowledge_topic_merge(uuid, uuid) from public, anon, authenticated;

-- ── 9. Shelves: the six D100 sub-categories (FR-KNOW-001 AC3) ─────────────────────────
insert into public.categories (world_slug, parent_id, slug, label_he, label_en, sort_order)
select 'knowledge', p.category_id, v.slug, v.label_he, v.label_en, v.ord
  from public.categories p
 cross join (values
   ('rights_legal_aid',  'זכויות וסיוע משפטי', 'Rights & legal aid',  12),
   ('lessons_mentoring', 'שיעורים וחונכות',    'Lessons & mentoring', 13)
 ) as v(slug, label_he, label_en, ord)
 where p.world_slug = 'knowledge' and p.slug = 'knowledge'
on conflict (world_slug, slug) do nothing;

-- ── 10. Seed topics (PRD 07_Knowledge §3 subjects; `legacy_category_slug` = the shelf row
--        each replaces). Roots first, then children; idempotent on slug. ────────────────
insert into public.knowledge_topics (slug, label_he, label_en, legacy_category_slug, sort_order)
values
  ('programming',          'תכנות וטכנולוגיה',  'Programming & technology', 'tech',         1),
  ('languages',            'שפות',              'Languages',                'languages',    2),
  ('math-science',         'מתמטיקה ומדעים',    'Math & science',           'stem',         3),
  ('professions',          'אקדמיה ומקצוע',     'Academia & professions',   'professional', 4),
  ('arts',                 'אומנויות',          'Arts',                     'arts',         5),
  ('cooking',              'בישול וקולינריה',   'Cooking',                  null,           6),
  ('personal-development', 'התפתחות אישית',     'Personal development',     null,           7),
  ('parenting',            'הורות וחינוך',      'Parenting & education',    'parenting',    8),
  ('life-skills',          'כישורי חיים',       'Life skills',              'life-skills',  9),
  ('tradition-heritage',   'מסורת ומורשת',      'Tradition & heritage',     null,          10),
  ('rights',               'זכויות',            'Rights',                   null,          11)
on conflict (slug) do nothing;

insert into public.knowledge_topics (slug, parent_id, label_he, label_en, sort_order)
select v.slug, p.topic_id, v.label_he, v.label_en, v.ord
  from (values
    ('python',                  'programming',          'פייתון',               'Python',                     1),
    ('javascript',              'programming',          'ג''אווהסקריפט',        'JavaScript',                 2),
    ('web-development',         'programming',          'פיתוח ווב',            'Web development',            3),
    ('artificial-intelligence', 'programming',          'בינה מלאכותית',        'Artificial intelligence',    4),
    ('cyber-security',          'programming',          'סייבר',                'Cyber security',             5),
    ('data-analysis',           'programming',          'ניתוח נתונים',         'Data analysis',              6),
    ('english',                 'languages',            'אנגלית',               'English',                    1),
    ('arabic',                  'languages',            'ערבית',                'Arabic',                     2),
    ('hebrew',                  'languages',            'עברית',                'Hebrew',                     3),
    ('french',                  'languages',            'צרפתית',               'French',                     4),
    ('russian',                 'languages',            'רוסית',                'Russian',                    5),
    ('spanish',                 'languages',            'ספרדית',               'Spanish',                    6),
    ('mathematics',             'math-science',         'מתמטיקה',              'Mathematics',                1),
    ('statistics',              'math-science',         'סטטיסטיקה',            'Statistics',                 2),
    ('physics',                 'math-science',         'פיזיקה',               'Physics',                    3),
    ('chemistry',               'math-science',         'כימיה',                'Chemistry',                  4),
    ('biology',                 'math-science',         'ביולוגיה',             'Biology',                    5),
    ('law',                     'professions',          'משפטים',               'Law',                        1),
    ('health-sciences',         'professions',          'מדעי הבריאות',         'Health sciences',            2),
    ('management',              'professions',          'ניהול',                'Management',                 3),
    ('economics',               'professions',          'כלכלה',                'Economics',                  4),
    ('accounting',              'professions',          'חשבונאות',             'Accounting',                 5),
    ('drawing',                 'arts',                 'ציור',                 'Drawing & painting',         1),
    ('photography',             'arts',                 'צילום',                'Photography',                2),
    ('music',                   'arts',                 'מוזיקה',               'Music',                      3),
    ('theatre',                 'arts',                 'תיאטרון',              'Theatre',                    4),
    ('creative-writing',        'arts',                 'כתיבה יוצרת',          'Creative writing',           5),
    ('time-management',         'personal-development', 'ניהול זמן',            'Time management',            1),
    ('meditation',              'personal-development', 'מדיטציה',              'Meditation',                 2),
    ('public-speaking',         'personal-development', 'דיבור מול קהל',        'Public speaking',            3),
    ('early-childhood',         'parenting',            'גיל הרך',              'Early childhood',            1),
    ('teenagers',               'parenting',            'גיל ההתבגרות',         'Teenagers',                  2),
    ('special-education',       'parenting',            'חינוך מיוחד',          'Special education',          3),
    ('personal-finance',        'life-skills',          'כלכלת המשפחה',         'Personal finance',           1),
    ('insurance',               'life-skills',          'ביטוח',                'Insurance',                  2),
    ('job-search',              'life-skills',          'חיפוש עבודה',          'Job search',                 3),
    ('digital-literacy',        'life-skills',          'אוריינות דיגיטלית',    'Digital literacy',           4),
    ('jewish-texts',            'tradition-heritage',   'מקורות יהודיים',       'Jewish texts',               1),
    ('israeli-history',         'tradition-heritage',   'תולדות ישראל',         'History of Israel',          2),
    ('philosophy',              'tradition-heritage',   'פילוסופיה',            'Philosophy',                 3),
    ('tenant-rights',           'rights',               'זכויות דיירים',        'Tenant rights',              1),
    ('employment-rights',       'rights',               'זכויות עובדים',        'Employment rights',          2),
    ('consumer-rights',         'rights',               'זכויות צרכנים',        'Consumer rights',            3),
    ('social-security',         'rights',               'ביטוח לאומי',          'Social security',            4),
    ('immigrant-rights',        'rights',               'זכויות עולים',         'New immigrants'' rights',    5)
  ) as v(slug, parent_slug, label_he, label_en, ord)
  join public.knowledge_topics p on p.slug = v.parent_slug
on conflict (slug) do nothing;

-- Aliases: common Hebrew spellings, transliterations and English synonyms. One alias may
-- belong to one topic only (unique when normalized), so none is repeated below.
insert into public.knowledge_topic_aliases (topic_id, alias, lang)
select t.topic_id, v.alias, v.lang
  from (values
    ('programming',             'תכנות',             'he'),
    ('programming',             'טכנולוגיה',         'he'),
    ('programming',             'technology',        'en'),
    ('programming',             'coding',            'en'),
    ('programming',             'קוד',               'he'),
    ('python',                  'פיתון',             'he'),
    ('python',                  'פייטון',            'he'),
    ('javascript',              'js',                'en'),
    ('javascript',              'ג''אווה סקריפט',    'he'),
    ('web-development',         'פיתוח אתרים',       'he'),
    ('web-development',         'web',               'en'),
    ('artificial-intelligence', 'ai',                'en'),
    ('artificial-intelligence', 'machine learning',  'en'),
    ('artificial-intelligence', 'למידת מכונה',       'he'),
    ('cyber-security',          'אבטחת מידע',        'he'),
    ('cyber-security',          'cyber',             'en'),
    ('data-analysis',           'data',              'en'),
    ('data-analysis',           'דאטה',              'he'),
    ('languages',               'לימוד שפות',        'he'),
    ('languages',               'language',          'en'),
    ('english',                 'אינגליש',           'he'),
    ('hebrew',                  'אולפן',             'he'),
    ('hebrew',                  'ulpan',             'other'),
    ('math-science',            'מדעים',             'he'),
    ('math-science',            'science',           'en'),
    ('mathematics',             'חשבון',             'he'),
    ('mathematics',             'math',              'en'),
    ('mathematics',             'maths',             'en'),
    ('physics',                 'פיסיקה',            'he'),
    ('professions',             'אקדמיה',            'he'),
    ('professions',             'career',            'en'),
    ('law',                     'משפט',              'he'),
    ('management',              'מנהל עסקים',        'he'),
    ('management',              'business',          'en'),
    ('accounting',              'ראיית חשבון',       'he'),
    ('accounting',              'הנהלת חשבונות',     'he'),
    ('arts',                    'אמנות',             'he'),
    ('arts',                    'art',               'en'),
    ('drawing',                 'רישום',             'he'),
    ('drawing',                 'painting',          'en'),
    ('music',                   'מוסיקה',            'he'),
    ('music',                   'נגינה',             'he'),
    ('theatre',                 'משחק',              'he'),
    ('theatre',                 'drama',             'en'),
    ('creative-writing',        'כתיבה',             'he'),
    ('cooking',                 'אפייה',             'he'),
    ('cooking',                 'baking',            'en'),
    ('cooking',                 'מתכונים',           'he'),
    ('personal-development',    'פיתוח אישי',        'he'),
    ('meditation',              'מיינדפולנס',        'he'),
    ('meditation',              'mindfulness',       'en'),
    ('parenting',               'הורות',             'he'),
    ('parenting',               'חינוך',             'he'),
    ('parenting',               'education',         'en'),
    ('teenagers',               'בני נוער',          'he'),
    ('teenagers',               'נוער',              'he'),
    ('personal-finance',        'תקציב',             'he'),
    ('personal-finance',        'בנקאות',            'he'),
    ('personal-finance',        'חיסכון',            'he'),
    ('job-search',              'קורות חיים',        'he'),
    ('job-search',              'ראיון עבודה',       'he'),
    ('digital-literacy',        'מחשב למתחילים',     'he'),
    ('digital-literacy',        'סמארטפון',          'he'),
    ('tradition-heritage',      'יהדות',             'he'),
    ('tradition-heritage',      'judaism',           'en'),
    ('tradition-heritage',      'היסטוריה',          'he'),
    ('tradition-heritage',      'history',           'en'),
    ('jewish-texts',            'תורה',              'he'),
    ('jewish-texts',            'תנ"ך',              'he'),
    ('jewish-texts',            'תלמוד',             'he'),
    ('jewish-texts',            'גמרא',              'he'),
    ('rights',                  'מיצוי זכויות',      'he'),
    ('rights',                  'כל זכות',           'he'),
    ('tenant-rights',           'שכירות',            'he'),
    ('employment-rights',       'דיני עבודה',        'he'),
    ('social-security',         'קצבאות',            'he'),
    ('immigrant-rights',        'עלייה',             'he'),
    ('immigrant-rights',        'עולים חדשים',       'he')
  ) as v(slug, alias, lang)
  join public.knowledge_topics t on t.slug = v.slug
 where not exists (
   select 1 from public.knowledge_topic_aliases a
    where a.alias_norm = public.knowledge_normalize_text(v.alias));

-- ── 11. The PRD subject rows stop being shelves (FR-KNOW-001 AC2): rows stay, listings
--        keep their category_id, pickers and browse chips no longer offer them. ─────────
update public.categories c
   set is_active = false
  from public.knowledge_topics t
 where c.world_slug = 'knowledge'
   and c.slug = t.legacy_category_slug
   and c.is_active;

commit;
