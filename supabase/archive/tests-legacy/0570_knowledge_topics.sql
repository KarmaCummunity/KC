-- supabase/tests/0570_knowledge_topics.sql | 0570 (FR-KNOW-001): the knowledge topic graph.
-- Seeds, the six shelves, normalization, alias resolution (Hebrew final letters, niqqud,
-- punctuation), descendants, depth cap, cycle rejection, proposals and their limit, the
-- proposer's own edits, operator-only review (approve / reject / rename / merge), merge
-- re-pointing (children, followers, aliases, old slug as alias) and function privileges.

begin;

create temp table personas as
select kc_test.create_user('topics_member') as member,
       kc_test.create_user('topics_other') as other,
       kc_test.create_user('topics_moderator') as moderator;
insert into public.admin_role_grants (user_id, role) select moderator, 'moderator' from personas;

-- ── Seeds and shelves ──────────────────────────────────────────────────────────────────
select kc_test.assert_eq(
  (select count(*)::int from public.categories
    where world_slug = 'knowledge' and is_active and parent_id is not null),
  6, 'exactly the six D100 shelves are active knowledge sub-categories');
select kc_test.assert_true(
  (select bool_and(slug in ('science_technology', 'history_heritage', 'culture_art',
                            'spirituality_philosophy', 'rights_legal_aid', 'lessons_mentoring'))
     from public.categories where world_slug = 'knowledge' and is_active and parent_id is not null),
  'the active shelves are the D100 list');
select kc_test.assert_eq(
  (select is_active from public.categories where world_slug = 'knowledge' and slug = 'tech'),
  false, 'the PRD subject row "tech" is kept but no longer a shelf');
select kc_test.assert_eq(
  (select legacy_category_slug from public.knowledge_topics where slug = 'programming'),
  'tech'::text, 'the programming topic records the shelf row it replaces');
select kc_test.assert_true(
  (select count(*) from public.knowledge_topics where status = 'active') >= 50,
  'the seed tree holds the PRD subjects and their first children');
select kc_test.assert_eq(
  (select p.slug from public.knowledge_topics c join public.knowledge_topics p on p.topic_id = c.parent_id
    where c.slug = 'python'),
  'programming'::text, 'python sits under programming');

-- ── Normalization ──────────────────────────────────────────────────────────────────────
select kc_test.assert_eq(public.knowledge_normalize_text('  Python,  3.12! '), 'python 3 12'::text,
  'lower-case, punctuation to spaces, collapsed');
select kc_test.assert_eq(public.knowledge_normalize_text('פייתוֹן'), 'פייתונ'::text,
  'niqqud is stripped and the final nun folds');
select kc_test.assert_eq(public.knowledge_normalize_text('ג''אווה-סקריפט'),
  public.knowledge_normalize_text('ג אווה סקריפט'), 'geresh and dash compare equal to spaces');
select kc_test.assert_eq(public.knowledge_normalize_text(null), ''::text, 'null is the empty string');

-- ── Resolution ─────────────────────────────────────────────────────────────────────────
select kc_test.assert_true(
  exists (select 1 from public.resolve_knowledge_topics('רוצה ללמוד פיתון מאפס') where slug = 'python' and via = 'self'),
  'a Hebrew transliteration alias resolves the python topic');
select kc_test.assert_true(
  exists (select 1 from public.resolve_knowledge_topics('Machine Learning course') where slug = 'artificial-intelligence'),
  'a two-word English alias resolves through the adjacent-word pair');
select kc_test.assert_true(
  exists (select 1 from public.resolve_knowledge_topics('תכנות') where slug = 'python' and via = 'descendant'
            and matched_slug = 'programming'),
  'a match on a root includes its descendants, tagged with the matched root');
select kc_test.assert_eq(
  (select count(*)::int from public.resolve_knowledge_topics('')), 0, 'an empty query resolves nothing');
select kc_test.assert_eq(
  (select count(*)::int from public.resolve_knowledge_topics('xyzzy nothing here')), 0,
  'unknown words resolve nothing');
select kc_test.assert_eq(
  (select count(*)::int from public.resolve_knowledge_topics('python python')), 1,
  'a topic is returned once however often it matches');

-- ── Tree invariants ────────────────────────────────────────────────────────────────────
do $$
declare
  v_root uuid := (select topic_id from public.knowledge_topics where slug = 'programming');
  v_l2 uuid := (select topic_id from public.knowledge_topics where slug = 'python');
  v_l3 uuid;
  v_l4 uuid;
begin
  insert into public.knowledge_topics (slug, parent_id, label_he, label_en)
  values ('python-for-data', v_l2, 'פייתון לנתונים', 'Python for data') returning topic_id into v_l3;
  insert into public.knowledge_topics (slug, parent_id, label_he, label_en)
  values ('pandas', v_l3, 'פנדס', 'pandas') returning topic_id into v_l4;

  perform kc_test.assert_raises(
    format('insert into public.knowledge_topics (slug, parent_id, label_he, label_en) values (%L, %L, %L, %L)',
           'pandas-groupby', v_l4, 'קיבוץ', 'groupby'),
    'knowledge_topic_depth_exceeded', 'a fifth level is refused');
  perform kc_test.assert_raises(
    format('update public.knowledge_topics set parent_id = %L where topic_id = %L', v_l4, v_root),
    'knowledge_topic_cycle', 'a root cannot be parented under its own descendant');
  perform kc_test.assert_raises(
    format('update public.knowledge_topics set parent_id = %L where topic_id = %L', v_l2, v_l2),
    'knowledge_topic_cycle', 'a topic cannot be its own parent');
  perform kc_test.assert_raises(
    format('update public.knowledge_topics set parent_id = %L where topic_id = %L', v_l4, v_l2),
    'knowledge_topic_cycle', 'moving python under its own descendant is a cycle first');
  -- Re-parenting counts the branch's height: python (two levels below it) under english = level 5.
  perform kc_test.assert_raises(
    format('update public.knowledge_topics set parent_id = (select topic_id from public.knowledge_topics where slug = %L) where topic_id = %L',
           'english', v_l2),
    'knowledge_topic_depth_exceeded', 'moving a branch where its deepest leaf would be level 5 is refused');
  perform kc_test.assert_raises(
    'insert into public.knowledge_topic_aliases (topic_id, alias) select topic_id, ''Machine  Learning'' from public.knowledge_topics where slug = ''english''',
    'duplicate key value violates unique constraint "knowledge_topic_aliases_norm_uidx"',
    'an alias equal (normalized: case, spacing) to an existing one is refused');
end $$;

-- ── Proposals ──────────────────────────────────────────────────────────────────────────
do $$
declare
  p personas;
  v_topic public.knowledge_topics;
begin
  select * into p from personas;

  perform kc_test.act_as_anon();
  perform kc_test.assert_raises(
    'select public.propose_knowledge_topic(''rust'', ''ראסט'', ''Rust'', ''programming'')',
    'auth_required', 'a proposal needs a session');

  perform kc_test.act_as(p.member);
  v_topic := public.propose_knowledge_topic('rust', 'ראסט', 'Rust', 'programming', 'שפת תכנות');
  perform kc_test.assert_eq(v_topic.status, 'proposed'::text, 'a member proposal is proposed');
  perform kc_test.assert_eq(v_topic.created_by, p.member, 'and records the proposer');
  perform kc_test.assert_true(
    exists (select 1 from public.resolve_knowledge_topics('Rust') where slug = 'rust'),
    'a proposed topic is usable at once');

  perform kc_test.assert_raises(
    'select public.propose_knowledge_topic(''rust'', ''ראסט'', ''Rust'')',
    'knowledge_topic_slug_taken', 'a slug may not repeat');
  perform kc_test.assert_raises(
    'select public.propose_knowledge_topic(''machine-learning'', ''למידת מכונה'', ''Machine learning'')',
    'knowledge_topic_slug_taken', 'a slug may not shadow an alias');
  perform kc_test.assert_raises(
    'select public.propose_knowledge_topic(''Bad Slug!'', ''x'', ''x'')',
    'knowledge_topic_slug_invalid', 'slugs are lower-case kebab');
  perform kc_test.assert_raises(
    'select public.propose_knowledge_topic(''kotlin'', ''קוטלין'', ''Kotlin'', ''no-such-parent'')',
    'knowledge_topic_parent_missing', 'the parent must exist');

  v_topic := public.update_my_proposed_knowledge_topic(v_topic.topic_id, 'ראסט (שפה)', 'Rust (language)');
  perform kc_test.assert_eq(v_topic.label_en, 'Rust (language)'::text, 'the proposer edits their own proposal');

  perform kc_test.act_as(p.other);
  perform kc_test.assert_raises(
    format('select public.update_my_proposed_knowledge_topic(%L, ''a'', ''b'')', v_topic.topic_id),
    'knowledge_topic_not_editable', 'another member cannot edit it');
  perform kc_test.assert_raises(
    format('select public.review_knowledge_topic(%L, ''approve'')', v_topic.topic_id),
    'forbidden', 'a plain member cannot review');

  -- Ten open proposals is the cap.
  perform kc_test.act_as(p.other);
  for i in 1..10 loop
    perform public.propose_knowledge_topic('other-topic-' || i, 'נושא ' || i, 'Topic ' || i);
  end loop;
  perform kc_test.assert_raises(
    'select public.propose_knowledge_topic(''other-topic-11'', ''נושא'', ''Topic'')',
    'knowledge_topic_proposal_limit', 'the eleventh open proposal is refused');
end $$;

-- ── Review: approve / rename / reject / merge ──────────────────────────────────────────
do $$
declare
  p personas;
  v_rust uuid := (select topic_id from public.knowledge_topics where slug = 'rust');
  v_python uuid := (select topic_id from public.knowledge_topics where slug = 'python');
  v_pandas uuid := (select topic_id from public.knowledge_topics where slug = 'pandas');
  v_data uuid := (select topic_id from public.knowledge_topics where slug = 'data-analysis');
  v_row public.knowledge_topics;
  v_alias public.knowledge_topic_aliases;
begin
  select * into p from personas;
  perform kc_test.act_as(p.moderator);

  v_row := public.review_knowledge_topic(v_rust, 'rename', null, 'ראסט', 'Rust');
  perform kc_test.assert_eq(v_row.label_he, 'ראסט'::text, 'rename updates the labels');
  v_row := public.review_knowledge_topic(v_rust, 'approve');
  perform kc_test.assert_eq(v_row.status, 'active'::text, 'approve activates');
  perform kc_test.assert_eq(v_row.approved_by, p.moderator, 'and records the reviewer');

  v_alias := public.add_knowledge_topic_alias(v_rust, 'ראסט לנג', 'he');
  perform kc_test.assert_eq(v_alias.topic_id, v_rust, 'an operator adds an alias');
  perform kc_test.assert_raises(
    format('select public.add_knowledge_topic_alias(%L, ''machine learning'', ''en'')', v_rust),
    'knowledge_topic_alias_taken', 'an alias already in use is refused');

  perform kc_test.assert_raises(
    format('select public.review_knowledge_topic(%L, ''reject'')', v_rust),
    'knowledge_topic_not_proposed', 'only a proposal can be rejected');
  perform kc_test.assert_raises(
    format('select public.review_knowledge_topic(%L, ''dance'')', v_rust),
    'knowledge_topic_action_invalid', 'unknown actions are refused');
  v_row := public.review_knowledge_topic(
    (select topic_id from public.knowledge_topics where slug = 'other-topic-1'), 'reject');
  perform kc_test.assert_eq(
    (select count(*)::int from public.knowledge_topics where slug = 'other-topic-1'), 0, 'reject removes the proposal');

  -- Merge "python-for-data" (child: pandas, one follower, one alias) into "data-analysis".
  perform kc_test.act_as(p.member);
  insert into public.knowledge_topic_follows (user_id, topic_id)
  values (p.member, (select topic_id from public.knowledge_topics where slug = 'python-for-data'));
  insert into public.knowledge_topic_follows (user_id, topic_id) values (p.member, v_data);
  perform kc_test.act_as(p.moderator);
  perform public.add_knowledge_topic_alias(
    (select topic_id from public.knowledge_topics where slug = 'python-for-data'), 'py4data', 'en');

  perform kc_test.assert_raises(
    format('select public.review_knowledge_topic(%L, ''merge'', %L)', v_python, v_pandas),
    'knowledge_topic_merge_into_descendant', 'a topic cannot merge into its own descendant');
  perform kc_test.assert_raises(
    format('select public.review_knowledge_topic(%L, ''merge'', %L)', v_python, v_python),
    'knowledge_topic_merge_target_invalid', 'nor into itself');

  v_row := public.review_knowledge_topic(
    (select topic_id from public.knowledge_topics where slug = 'python-for-data'), 'merge', v_data);
  perform kc_test.assert_eq(v_row.status, 'merged'::text, 'merge marks the source merged');
  perform kc_test.assert_eq(v_row.merged_into_id, v_data, 'pointing at the target');
  perform kc_test.assert_eq(
    (select parent_id from public.knowledge_topics where topic_id = v_pandas), v_data,
    'children move under the target');
  perform kc_test.assert_eq(
    (select count(*)::int from public.knowledge_topic_follows where user_id = p.member and topic_id = v_data), 1,
    'followers move to the target without duplicates');
  perform kc_test.assert_eq(
    (select count(*)::int from public.knowledge_topic_follows where topic_id = v_row.topic_id), 0,
    'and leave the merged topic');
  perform kc_test.assert_eq(
    (select topic_id from public.knowledge_topic_aliases where alias = 'py4data'), v_data,
    'aliases move to the target');
  perform kc_test.assert_eq(
    (select topic_id from public.knowledge_topic_aliases where alias_norm = public.knowledge_normalize_text('python for data')),
    v_data, 'the old slug becomes an alias of the target');
  perform kc_test.assert_true(
    exists (select 1 from public.resolve_knowledge_topics('python-for-data') where slug = 'data-analysis' and via = 'self'),
    'the old slug keeps resolving, to the target');
  perform kc_test.assert_eq(
    (select count(*)::int from public.resolve_knowledge_topics('python-for-data') where slug = 'python-for-data'), 0,
    'the merged topic itself is never returned');
  perform kc_test.assert_raises(
    format('select public.review_knowledge_topic(%L, ''approve'')', v_row.topic_id),
    'knowledge_topic_already_merged', 'a merged topic is final');
  perform kc_test.assert_raises(
    format('insert into public.knowledge_topics (slug, parent_id, label_he, label_en) values (''under-merged'', %L, ''x'', ''x'')', v_row.topic_id),
    'knowledge_topic_parent_merged', 'nothing is created under a merged topic');
end $$;

-- ── Privileges ─────────────────────────────────────────────────────────────────────────
select kc_test.assert_true(has_function_privilege('anon', 'public.resolve_knowledge_topics(text)', 'execute'),
  'anyone resolves topics');
select kc_test.assert_true(not has_function_privilege('anon', 'public.propose_knowledge_topic(text,text,text,text,text)', 'execute'),
  'anon cannot propose');
select kc_test.assert_true(has_function_privilege('authenticated', 'public.review_knowledge_topic(uuid,text,uuid,text,text)', 'execute'),
  'review is callable by members (the operator check is inside)');
select kc_test.assert_true(not has_function_privilege('authenticated', 'public.knowledge_topic_merge(uuid,uuid)', 'execute'),
  'the merge helper is internal');
select kc_test.assert_true(not has_function_privilege('authenticated', 'public.knowledge_topic_subtree_height(uuid)', 'execute'),
  'the height helper is internal');

rollback;
\echo '✓ 0570_knowledge_topics.sql passed'
