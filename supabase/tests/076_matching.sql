-- Matching: a post write only enqueues work; the engine pairs the right posts and never a
-- blocked, private or distant one; embedding jobs are claimed once; owners answer their
-- pairs along the machine; similar and recommended posts respect what the caller may read.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- `@x` is a member, `#NN` a post of the fixture.
create function pg_temp.sql(p_sql text)
returns text
language sql
as $$
  select regexp_replace(regexp_replace(p_sql, '@([a-e])', '''00000000-0000-4000-8000-00000000000\1''::uuid', 'g'),
                        '#(\d\d)', '''10000000-0000-4000-8000-0000000000\1''::uuid', 'g');
$$;
-- Runs a statement as a member (anon when null): 'ok', a P0001 message, or the SQLSTATE.
create function pg_temp.act(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_role constant text := case when p_who is null then 'anon' else 'authenticated' end;
  v_sql constant text := pg_temp.sql(p_sql);
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', v_role)::text, true);
  perform set_config('role', v_role, true);
  execute v_sql;
  perform set_config('role', 'none', true);
  return 'ok';
exception when others then
  perform set_config('role', 'none', true);
  return case sqlstate when 'P0001' then sqlerrm else sqlstate end;
end;
$$;
-- One value a member reads with a query.
create function pg_temp.get(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql constant text := pg_temp.sql(p_sql);
  v_value text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute v_sql into v_value;
  perform set_config('role', 'none', true);
  return v_value;
end;
$$;
-- Events of a topic waiting in the outbox.
create function pg_temp.queued(p_topic text, p_kind text default null)
returns bigint
language sql
as $$
  select count(*) from kc_private.outbox_events e
   where e.topic = p_topic and e.processed_at is null and (p_kind is null or e.payload ->> 'kind' = p_kind);
$$;
-- Pairs as 'offer-request:status', by the last two digits of the post ids.
create function pg_temp.pairs()
returns text
language sql
as $$
  select coalesce(string_agg(right(m.offer_post_id::text, 2) || '-' || right(m.request_post_id::text, 2)
                             || ':' || m.status, ' ' order by m.offer_post_id, m.request_post_id), '')
    from kc_private.match_candidates m;
$$;
-- The id of the one pair of an offer post.
create function pg_temp.pair_of(p_offer text)
returns uuid
language sql
as $$
  select m.id from kc_private.match_candidates m where right(m.offer_post_id::text, 2) = p_offer;
$$;
-- A unit vector along one axis.
create function pg_temp.axis(p_axis integer)
returns extensions.vector
language sql
as $$
  select ('[' || string_agg((i = p_axis)::integer::text, ',' order by i) || ']')::extensions.vector
    from generate_series(1, 1536) i;
$$;

select plan(50);

-- Alice offers. Bob, Carol, Dan and Eve ask. Carol and Alice are blocked.
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b', 'c', 'd', 'e']) x;
insert into public.blocks (blocker_id, blocked_id) values
  ('00000000-0000-4000-8000-00000000000c', '00000000-0000-4000-8000-00000000000a');
insert into public.cities (city_id, name_he, name_en, location) values
  ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)'),
  ('c2', 'c2', 'Far City', 'SRID=4326;POINT(34.95 29.55)');
insert into public.worlds (slug, label_he, label_en) values ('items', 'items', 'items');
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction)
values ('20000000-0000-4000-8000-000000000001', 'items', 'item', 'item', 'item', 'either');

-- 01 the offer · 02 the request that fits · 03 another object · 04 blocked owner
-- · 05 "only me" · 06 too far · 07 a draft.
insert into public.posts (id, owner_id, world_slug, kind_id, direction, status, visibility, title, city_id)
select ('10000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       ('00000000-0000-4000-8000-00000000000' || o)::uuid, 'items', '20000000-0000-4000-8000-000000000001',
       d, s, v, t, c
  from (values
    (1, 'a', 'offer', 'open', 'Public', 'baby stroller blue', 'c1'),
    (2, 'b', 'request', 'open', 'Public', 'looking for baby stroller', 'c1'),
    (3, 'b', 'request', 'open', 'Public', 'need a bookshelf', 'c1'),
    (4, 'c', 'request', 'open', 'Public', 'baby stroller please', 'c1'),
    (5, 'd', 'request', 'open', 'OnlyMe', 'baby stroller wanted', 'c1'),
    (6, 'e', 'request', 'open', 'Public', 'baby stroller', 'c2'),
    (7, 'a', 'offer', 'draft', 'Public', 'baby stroller draft', 'c1')
  ) as p (n, o, d, s, v, t, c);

-- ── A post write only enqueues ───────────────────────────────────────────────
select is(pg_temp.queued('match') || '/' || pg_temp.queued('embedding'), '6/6',
  'each published post asks for one matching run and one embedding; a draft for neither');
update public.posts set urgency_level = 2 where id = '10000000-0000-4000-8000-000000000003';
select is(pg_temp.queued('match') || '/' || pg_temp.queued('embedding'), '6/6', 'an edit neither consumer reads enqueues nothing');
update public.posts set visibility = 'FollowersOnly' where id = '10000000-0000-4000-8000-000000000003';
select is(pg_temp.queued('match') || '/' || pg_temp.queued('embedding'), '7/6', 'an audience change asks for matching only');
update public.posts set title = 'need a tall bookshelf' where id = '10000000-0000-4000-8000-000000000003';
select is(pg_temp.queued('match') || '/' || pg_temp.queued('embedding'), '8/7', 'a new title asks for both');
select is((select count(*) from kc_private.match_candidates), 0::bigint, 'nothing was matched inside the write');

-- ── The engine pairs the right posts ─────────────────────────────────────────
select is(kc_private.match_process(), 8, 'the consumer performs every queued run');
select is(pg_temp.pairs(), '01-02:suggested',
  'the offer is paired with the request that fits — never with another object, a blocked owner, a private post or a distant one');
select is((select (components ->> 'text')::numeric >= 0.5 and (components ->> 'geo')::numeric = 1
                  and not components ? 'vector' and score >= 0.6
             from kc_private.match_candidates), true, 'the score is the weighted mean of the components that could be measured');
select is(pg_temp.queued('notification', 'match_suggested'), 2::bigint, 'both owners are told about a pair above the announce score');
select is(kc_private.match_compute_for_post('10000000-0000-4000-8000-000000000001') || '/' || pg_temp.pairs()
          || '/' || kc_private.match_announce(), '1/01-02:suggested/0', 'a repeated run changes nothing and announces nothing twice');

-- ── Embedding jobs ───────────────────────────────────────────────────────────
select is((select count(*) || '/' || count(*) filter (where title is not null) from public.embedding_jobs_claim(50)), '6/6',
  'the worker claims one job per published post, with its text');
select is((select count(*) from public.embedding_jobs_claim(50)), 0::bigint, 'a claimed job is not handed out twice');
update kc_private.embedding_jobs set claimed_at = now() - interval '11 minutes'
 where post_id = '10000000-0000-4000-8000-000000000006';
select is((select count(*) from public.embedding_jobs_claim(50)), 1::bigint, 'a job whose worker went silent is handed out again');
select is(public.embedding_job_store('10000000-0000-4000-8000-000000000001', pg_temp.axis(1), 'test-model'), true,
  'storing the embedding closes the job');
select lives_ok($$select public.embedding_job_store(('10000000-0000-4000-8000-00000000000' || n)::uuid, pg_temp.axis(a), 'test-model')
                    from (values (2, 1), (3, 2), (4, 1)) as v (n, a)$$, 'more embeddings are stored');
select lives_ok($$select public.embedding_job_fail('10000000-0000-4000-8000-000000000005', 'provider error')$$, 'a failure is recorded');
select is((select string_agg(status, ',' order by post_id) from kc_private.embedding_jobs),
  'done,done,done,done,failed,processing', 'each job shows where it stands');
-- The queue moves along the graph (machine `embedding_job`).
select throws_ok($$update kc_private.embedding_jobs set status = 'failed' where post_id = '10000000-0000-4000-8000-000000000001'$$,
  'P0001', 'illegal_transition', 'a stored job is not marked failed afterwards');
select throws_ok($$update kc_private.embedding_jobs set status = 'stuck' where post_id = '10000000-0000-4000-8000-000000000006'$$,
  'P0001', 'unknown_state', 'a job takes only a state of the graph');
select throws_ok($$select public.embedding_job_store(gen_random_uuid(), pg_temp.axis(1), 'm')$$, 'P0001', 'embedding_job_not_found',
  'an unknown job is refused');
select is(pg_temp.act('a', 'select public.embedding_jobs_claim(1)') || '/' || pg_temp.act('a', 'select 1 from public.post_embeddings')
       || '/' || pg_temp.act('a', 'select 1 from kc_private.match_candidates') || '/'
       || pg_temp.act('a', 'select public.api_match_llm_pending(1)'), '42501/42501/42501/42501',
  'the worker functions, the embeddings and the pairs are closed to a device');
do $$ begin perform kc_private.match_process(); end $$;
select is((select (components ->> 'vector')::numeric from kc_private.match_candidates), 1::numeric,
  'a stored embedding re-runs matching and the pair gains its meaning component');
select is(pg_temp.pairs(), '01-02:suggested', 'and a nearest-vector candidate behind a block is still never paired');

-- ── My matches and answers ───────────────────────────────────────────────────
select is(pg_temp.get('a', $$select my_role || ':' || right((other_post).id::text, 2) || ':' || my_post_title from public.my_matches()$$),
  'offer:02:baby stroller blue', 'the offer''s owner sees the pair with the other post as a card');
select is(pg_temp.get('b', 'select count(*) from public.my_matches()') || '/' || pg_temp.get('e', 'select count(*) from public.my_matches()'),
  '1/0', 'the other owner sees it too; nobody else does');
select is(pg_temp.act('e', $$select public.match_respond('$$ || pg_temp.pair_of('01') || $$', true)$$), 'match_not_found',
  'a member cannot answer a pair that is not theirs');
select is(pg_temp.get('a', $$select public.match_respond('$$ || pg_temp.pair_of('01') || $$', true)$$), 'suggested',
  'one accept leaves the pair open');
select is(pg_temp.queued('notification', 'match_interest'), 1::bigint, 'and tells the other owner');
select is(pg_temp.get('b', $$select public.match_respond('$$ || pg_temp.pair_of('01') || $$', true)$$), 'accepted', 'the second accept makes it a match');
select is(pg_temp.queued('notification', 'match_accepted'), 1::bigint, 'and tells the first');
select is(pg_temp.act('a', $$select public.match_respond('$$ || pg_temp.pair_of('01') || $$', false)$$), 'match_not_open',
  'an accepted pair is not answered again');
select throws_ok($$update kc_private.match_candidates set status = 'suggested'$$, 'P0001', 'illegal_transition',
  'an accepted pair does not go back');
select throws_ok($$update kc_private.match_candidates set status = 'withdrawn'$$, 'P0001', 'unknown_state',
  'a status outside the machine is refused');

-- ── Off the air, back, and a decline ─────────────────────────────────────────
insert into public.posts (id, owner_id, world_slug, kind_id, direction, status, title, city_id) values
  ('10000000-0000-4000-8000-000000000008', '00000000-0000-4000-8000-00000000000a', 'items',
   '20000000-0000-4000-8000-000000000001', 'offer', 'open', 'toddler bed white', 'c1'),
  ('10000000-0000-4000-8000-000000000009', '00000000-0000-4000-8000-00000000000e', 'items',
   '20000000-0000-4000-8000-000000000001', 'request', 'open', 'toddler bed', 'c1');
do $$ begin perform kc_private.match_process(); end $$;
select is(pg_temp.pairs(), '01-02:accepted 08-09:suggested', 'a new offer and request are paired');
do $$ begin
  perform kc_private.post_move('10000000-0000-4000-8000-000000000008', 'paused', 'owner');
  perform kc_private.match_process();
end $$;
select is(pg_temp.pairs(), '01-02:accepted 08-09:expired', 'a paused post takes its open pair off; an accepted pair stays');
select is(pg_temp.get('e', 'select count(*) from public.my_matches()'), '0', 'an expired pair is not listed');
do $$ begin
  perform kc_private.post_move('10000000-0000-4000-8000-000000000008', 'open', 'owner');
  perform kc_private.match_process();
end $$;
select is(pg_temp.pairs(), '01-02:accepted 08-09:suggested', 'and the pair returns with the post');
select is(pg_temp.queued('notification', 'match_suggested'), 4::bigint, 'each owner was told about the pair once, not again on its return');
select is(pg_temp.get('e', $$select public.match_respond('$$ || pg_temp.pair_of('08') || $$', false)$$), 'declined', 'a decline closes the pair');
insert into public.posts (id, owner_id, world_slug, kind_id, direction, status, title, city_id) values
  ('10000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000a', 'items',
   '20000000-0000-4000-8000-000000000001', 'offer', 'open', 'toddler bed again', 'c1');
do $$ begin perform kc_private.match_process(); end $$;
select is(pg_temp.pairs(), '01-02:accepted 08-09:declined', 'two owners who declined a pair are not paired again');

-- ── Language-model re-rank ───────────────────────────────────────────────────
insert into public.posts (id, owner_id, world_slug, kind_id, direction, status, title, city_id) values
  ('10000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-00000000000d', 'items',
   '20000000-0000-4000-8000-000000000001', 'request', 'open', 'toddler bed again please', 'c1');
do $$ begin perform kc_private.match_process(); end $$;
select is((select count(*) from public.api_match_llm_pending(10)), 0::bigint, 'nothing waits for an opinion while the re-rank is off');
update kc_private.matching_settings set llm_rerank_enabled = true;
select is((select string_agg(distinct request_title, ',') from public.api_match_llm_pending(10)), 'toddler bed again please', 'switched on, open pairs wait for one');
select throws_ok($$select public.api_match_llm_store('$$ || pg_temp.pair_of('10') || $$', 1.5, 'x')$$, 'P0001', 'invalid_input',
  'an opinion is a score between 0 and 1');
select lives_ok($$select public.api_match_llm_store('$$ || pg_temp.pair_of('10') || $$', 0, 'not the same thing')$$, 'an opinion is stored');
select is(pg_temp.get('d', $$select bool_or(score < 1 and llm_reason = 'not the same thing')::text from public.my_matches()$$), 'true',
  'and blended into the score the owners see');

-- ── Similar and recommended posts ────────────────────────────────────────────
select is(pg_temp.get('d', $$select string_agg(right(id::text, 2), ',' order by id) from public.similar_posts(#01)$$), '02,04',
  'similar posts are the nearest in meaning that the caller may read (an "only me" post is left out)');
select is(pg_temp.get('c', 'select count(*) from public.similar_posts(#01)'), '0', 'nothing is returned for a post the caller cannot read');
select is(pg_temp.act('e', 'insert into public.saved_posts (user_id, post_id) values (@e, #02)'), 'ok', 'Eve saves a post');
select is(pg_temp.get('e', $$select string_agg(right(id::text, 2), ',' order by id) from public.recommended_posts()$$) || '/'
       || pg_temp.get('b', 'select count(*) from public.recommended_posts()'), '01,04/0',
  'recommendations are the posts nearest to what the caller saved, without the saved ones; none without a signal');

delete from auth.users where id = '00000000-0000-4000-8000-00000000000b';
select is(pg_temp.pairs(), '08-09:declined 08-11:suggested 10-11:suggested', 'removing a member removes their pairs');

select * from finish();
rollback;
