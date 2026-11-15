-- 0445 — `chat-media` / `post-images` object SELECT is owner-scoped.
-- Asserts the policy shape: no SELECT/ALL policy on these buckets grants
-- `anon`, and every remaining SELECT policy is restricted to the owner's
-- first path segment. Since 0521 `chat-media` also has one policy gated by
-- chat visibility (participants read the chat's images, #1064).

create or replace function pg_temp.assert(p_cond boolean, p_msg text)
returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'ASSERT FAILED: %', p_msg; end if;
end $$;

do $$
declare
  v_bucket text;
  v_anon   integer;
  v_open   integer;
  v_owner  integer;
begin
  foreach v_bucket in array array['chat-media', 'post-images'] loop
    -- Any SELECT/ALL policy mentioning the bucket that is granted to anon.
    select count(*) into v_anon
      from pg_policies
     where schemaname = 'storage'
       and tablename  = 'objects'
       and cmd in ('SELECT', 'ALL')
       and qual like '%' || v_bucket || '%'
       and 'anon' = any (roles);
    perform pg_temp.assert(v_anon = 0,
      format('%s: SELECT policy granted to anon (%s found)', v_bucket, v_anon));

    -- Any SELECT/ALL policy on the bucket that is not owner-scoped.
    select count(*) into v_open
      from pg_policies
     where schemaname = 'storage'
       and tablename  = 'objects'
       and cmd in ('SELECT', 'ALL')
       and qual like '%' || v_bucket || '%'
       and qual not like '%foldername%auth.uid()%'
       and not (v_bucket = 'chat-media' and qual like '%is_chat_visible_to%auth.uid()%');
    perform pg_temp.assert(v_open = 0,
      format('%s: SELECT policy not scoped to the owner path (%s found)', v_bucket, v_open));

    -- Owner SELECT must exist (uploads with upsert require it).
    select count(*) into v_owner
      from pg_policies
     where schemaname = 'storage'
       and tablename  = 'objects'
       and cmd = 'SELECT'
       and qual like '%' || v_bucket || '%'
       and qual like '%foldername%auth.uid()%';
    perform pg_temp.assert(v_owner >= 1,
      format('%s: owner-scoped SELECT policy missing', v_bucket));
  end loop;
end $$;

\echo '✓ 0445_storage_media_select_owner_scoped.sql passed'
