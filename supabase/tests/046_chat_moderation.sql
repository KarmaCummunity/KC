-- Chat moderation hooks: a chat reported past the threshold is hidden from its members and
-- comes back on restore; a moderator deletes one message with an audit row; nobody else can.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Runs a statement as member a, b or the moderator c. Returns 'ok', the message of a P0001
-- error or the SQLSTATE of any other error. `@a` `@b` `@c` stand for the member ids.
create function pg_temp.act(p_who text, p_sql text)
returns text
language plpgsql
as $$
begin
  begin
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    execute regexp_replace(p_sql, '@([abc])', '''00000000-0000-4000-8000-00000000000\1''::uuid', 'g');
    perform set_config('role', 'none', true);
    return 'ok';
  exception when others then
    perform set_config('role', 'none', true);
    return case sqlstate when 'P0001' then sqlerrm else sqlstate end;
  end;
end;
$$;

-- The number of chats a member can read.
create function pg_temp.chats_seen(p_who text)
returns bigint
language plpgsql
as $$
declare
  v_rows bigint;
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_rows from public.chats;
  perform set_config('role', 'none', true);
  return v_rows;
end;
$$;

select plan(9);

insert into auth.users (id, email, raw_app_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', 'a@example.test', '{"provider":"google"}'),
  ('00000000-0000-4000-8000-00000000000b', 'b@example.test', '{"provider":"google"}'),
  ('00000000-0000-4000-8000-00000000000c', 'c@example.test', '{"provider":"google"}');
insert into public.admin_role_grants (user_id, role) values ('00000000-0000-4000-8000-00000000000c', 'moderator');

select pg_temp.act('a', 'select public.open_direct_chat(@b)');
select pg_temp.act('a', $$select public.send_message((select id from public.chats limit 1), 'hello')$$);

-- The message id, readable by every role (the subquery of a test statement runs as the caller).
create temporary table t_msg as select id from public.messages limit 1;
grant select on t_msg to public;

select is(pg_temp.chats_seen('b'), 1::bigint, 'a member reads a chat they belong to');

-- Hide: the consumer performs the moderation event.
select kc_private.outbox_enqueue('moderation_target',
  jsonb_build_object('kind', 'hide', 'target_type', 'chat', 'target_id', (select id from public.chats limit 1)));
select is(kc_private.chat_moderation_process(), 1, 'the consumer performs the hide event');
select is(pg_temp.chats_seen('b'), 0::bigint, 'a hidden chat is not readable by its members');
select is(pg_temp.act('b', $$select public.send_message((select id from public.chats limit 1), 'hi')$$),
  'chat_not_found', 'and not writable');

-- Events about other targets are completed without effect.
select kc_private.outbox_enqueue('moderation_target',
  jsonb_build_object('kind', 'hide', 'target_type', 'post', 'target_id', gen_random_uuid()));
select is(kc_private.chat_moderation_process(), 1, 'an event about another target type is consumed without effect');

-- Restore.
select kc_private.outbox_enqueue('moderation_target',
  jsonb_build_object('kind', 'restore', 'target_type', 'chat', 'target_id', (select id from public.chats limit 1)));
select kc_private.chat_moderation_process();
select is(pg_temp.chats_seen('b'), 1::bigint, 'a restored chat is readable again');

-- Moderator deletes one message; a member cannot.
select is(pg_temp.act('a', $$select public.admin_delete_message((select id from t_msg))$$),
  '42501', 'a member cannot delete a message through the moderator RPC');
select is(pg_temp.act('c', $$select public.admin_delete_message((select id from t_msg))$$),
  'ok', 'a moderator deletes the message');
select is((select count(*) from public.messages) || '|' || (select count(*) from audit.events where action = 'delete_message'),
  '0|1', 'the message is gone and the deletion is audited');

select * from finish();
rollback;
