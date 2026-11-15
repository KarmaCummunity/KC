-- A photo sent in WhatsApp completes a bot draft (whatsapp_bot_post_photos): the draft a photo
-- would go to, the owner and draft checks, the photo limits, the media row the app would
-- write, and the publish gates (confidence/review, photo rule, rate limit) after the photo.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

create function pg_temp.uid(p_who text)
returns uuid
language sql
as $$ select ('00000000-0000-4000-8000-0000000000' || to_hex(ascii(p_who)))::uuid; $$;

-- Runs `p_sql` as the service role and returns its single value as text ('ok' for none),
-- or the P0001 message / the SQLSTATE of its error.
create function pg_temp.svc(p_sql text)
returns text
language plpgsql
as $$
declare
  v_out text;
begin
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform set_config('role', 'service_role', true);
  begin
    execute p_sql into v_out;
    v_out := coalesce(nullif(v_out, ''), 'ok');
  exception when others then
    v_out := case sqlstate when 'P0001' then sqlerrm else sqlstate end;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '{}', true);
  return v_out;
end;
$$;

create temporary table t_ids (k text primary key, v text);
create function pg_temp.keep(p_key text, p_value text)
returns text
language sql
as $$ insert into t_ids values (p_key, p_value) on conflict (k) do update set v = excluded.v returning v; $$;
create function pg_temp.v(p_key text)
returns text
language sql
as $$ select v from t_ids where k = p_key; $$;

-- A bot draft of the number, published through the bot; returns the session id.
create function pg_temp.draft(p_wa text, p_owner text, p_world text, p_kind text, p_dir text, p_conf numeric,
                              p_details jsonb default '{}')
returns text
language plpgsql
as $$
declare
  v_session text := pg_temp.svc(format('select public.api_bot_open_session(%L)', p_wa));
begin
  perform pg_temp.svc(format('select public.api_bot_apply_extraction(%L, %L, %L, %L, %L, %L, %s)',
                             v_session, p_world, p_kind, p_dir, 'a ' || p_kind, p_details, p_conf));
  perform pg_temp.svc(format('select public.api_bot_publish_post(%L, %L)', v_session, pg_temp.uid(p_owner)));
  return v_session;
end;
$$;

-- Attaches a photo; p_path defaults to a fresh file in the owner's folder.
create function pg_temp.attach(p_wa text, p_owner text, p_session text, p_mime text default 'image/jpeg',
                               p_size bigint default 120000, p_path text default null)
returns text
language sql
as $$
  select pg_temp.svc(format('select public.api_bot_attach_post_photo(%L, %L, %L, %L, %L, %s, 1080, 1440)',
    p_wa, pg_temp.uid(p_owner), p_session,
    coalesce(p_path, pg_temp.uid(p_owner) || '/' || gen_random_uuid() || '/0.jpg'), p_mime, p_size));
$$;

create function pg_temp.pending(p_wa text, p_owner text)
returns text
language sql
as $$ select pg_temp.svc(format('select public.api_bot_pending_photo_draft(%L, %L)', p_wa, pg_temp.uid(p_owner))); $$;

create function pg_temp.post_of(p_session text)
returns public.posts
language sql
as $$ select p.* from public.posts p
        join integrations.bot_conversation_sessions s on s.post_id = p.id where s.id = p_session::uuid; $$;

select plan(22);

-- a and b are linked members.
insert into auth.users (id, email, raw_app_meta_data)
select pg_temp.uid(x), 'u' || x || '@example.test', '{"provider":"google"}' from unnest(array['a', 'b']) x;
insert into public.cities (city_id, name_he, name_en) values ('c1', 'c1', 'City One');
update public.users set city_id = 'c1';
insert into public.worlds (slug, label_he, label_en) values ('items', 'חפצים', 'Items'), ('food', 'אוכל', 'Food');
insert into public.post_kinds (world_slug, slug, label_he, label_en, direction) values
  ('items', 'item_offer', 'o', 'o', 'offer'), ('items', 'item_request', 'r', 'r', 'request'),
  ('food', 'food_offer', 'o', 'o', 'offer');
insert into integrations.whatsapp_identities (wa_id, user_id) values
  ('972500000001', pg_temp.uid('a')), ('972500000002', pg_temp.uid('b'));

-- ── The draft a photo goes to ───────────────────────────────────────────────
select is(pg_temp.pending('972500000001', 'a'), 'ok', 'no draft waiting: nothing to attach to');
select pg_temp.keep('s1', pg_temp.draft('972500000001', 'a', 'items', 'item_offer', 'give', 1));
select is((pg_temp.post_of(pg_temp.v('s1'))).status, 'draft', 'a confident offer in a photo world waits for its photo');
select is(pg_temp.pending('972500000001', 'a')::jsonb - 'post_id',
  jsonb_build_object('session_id', pg_temp.v('s1'), 'world_slug', 'items', 'direction', 'offer', 'photos', 0),
  'it is the draft a photo sent now goes to');
select is(pg_temp.pending('972500000001', 'b'), '42501', 'only for the member the number is linked to');
select is(pg_temp.pending('972500000002', 'b'), 'ok', 'another number has no draft waiting');

-- ── Refusals ────────────────────────────────────────────────────────────────
select is(pg_temp.attach('972500000001', 'b', pg_temp.v('s1')), '42501', 'the owner must be the number''s linked member');
select is(pg_temp.attach('972500000002', 'b', pg_temp.v('s1')), '42501', 'and the session must be that number''s');
select is(pg_temp.attach('972500000001', 'a', pg_temp.v('s1'), 'image/gif'), 'invalid_media_type', 'JPEG or PNG only');
select is(pg_temp.attach('972500000001', 'a', pg_temp.v('s1'), 'image/png', 8388609), 'invalid_media_size',
  'at most 8 MB, the post photo limit');
select is(pg_temp.attach('972500000001', 'a', pg_temp.v('s1'), 'image/jpeg', 1000, pg_temp.uid('b') || '/x/0.jpg'),
  'invalid_storage_path', 'the file must sit in the owner''s folder');
select pg_temp.keep('s2', pg_temp.draft('972500000001', 'a', 'items', 'item_request', 'request', 1));
select is(pg_temp.attach('972500000001', 'a', pg_temp.v('s2')), 'not_bot_draft', 'a post already published is not a draft');
select is(pg_temp.attach('972500000001', 'a', '00000000-0000-4000-8000-000000000000'), 'session_not_found',
  'an unknown session is refused');
select is((select count(*) from public.post_media), 0::bigint, 'no refused photo left a media row');

-- ── Publish after the photo ─────────────────────────────────────────────────
select is(pg_temp.attach('972500000001', 'a', pg_temp.v('s1'))::jsonb - 'post_id' - 'media_id',
  '{"review": false, "status": "open", "world_slug": "items", "photo_required": false}', 'the photo publishes the offer');
select is((pg_temp.post_of(pg_temp.v('s1'))).status, 'open', 'which is now open');
select is((select string_agg(kind || ':' || storage_bucket || ':' || ordinal || ':' || mime_type || ':' || processing_status
                             || ':' || (owner_id = pg_temp.uid('a')), ',')
             from public.post_media where post_id = (pg_temp.post_of(pg_temp.v('s1'))).id),
  'image:post-images:0:image/jpeg:pending:true', 'with the media row the app''s attach path writes');
select is(pg_temp.pending('972500000001', 'a'), 'ok', 'and no draft is waiting any more');

select pg_temp.keep('s3', pg_temp.draft('972500000001', 'a', 'food', 'food_offer', 'give', 1,
                                        jsonb_build_object('expires_at', now() + interval '1 day')));
select is(pg_temp.attach('972500000001', 'a', pg_temp.v('s3'), 'image/png')::jsonb ->> 'status', 'open',
  'a food offer with its expiry is published once its photo arrives');

-- ── Low confidence stays in review ──────────────────────────────────────────
select pg_temp.keep('s4', pg_temp.draft('972500000001', 'a', 'items', 'item_offer', 'give', 0.8));
select is(pg_temp.attach('972500000001', 'a', pg_temp.v('s4'))::jsonb - 'post_id' - 'media_id',
  '{"review": true, "status": "draft", "world_slug": "items", "photo_required": false}',
  'below the publish confidence the photo is kept but the post stays a draft');
select is((select (pg_temp.post_of(pg_temp.v('s4'))).status || ':' || r.status from integrations.bot_review_items r
            where r.session_id = pg_temp.v('s4')::uuid), 'draft:pending', 'in the staff review queue');

-- ── Rate limit and age ──────────────────────────────────────────────────────
update kc_private.rate_limits set max_count = 1 where action = 'whatsapp_post_photo';
delete from kc_private.rate_limit_counters where key like 'whatsapp_post_photo:%';
select pg_temp.keep('s5', pg_temp.draft('972500000001', 'a', 'items', 'item_offer', 'give', 0.8));
select is(pg_temp.attach('972500000001', 'a', pg_temp.v('s5'))::jsonb ->> 'status' || ','
  || pg_temp.attach('972500000001', 'a', pg_temp.v('s5')), 'draft,rate_limited', 'photos sent through the bot are rate limited');
update integrations.bot_conversation_sessions set created_at = now() - interval '25 hours' where identity_id =
  (select id from integrations.whatsapp_identities where wa_id = '972500000001');
select is(pg_temp.pending('972500000001', 'a'), 'ok', 'a draft older than a day no longer takes photos from the chat');

select * from finish();
rollback;
