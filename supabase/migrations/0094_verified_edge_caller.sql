-- Verified DB caller isolation (platform secrets / background workers).
-- The default-branch legacy workflow can still rewrite kc_service_role_key.
-- Never copy that possibly unusable value and never fall back to it. Only the
-- reviewed deployment helper populates kc_verified_service_role_key after two
-- identical revealed-inventory reads and a nonclaiming Auth settings 200.
-- Missing verified configuration records a no-op warning until that step succeeds.
-- CREATE OR REPLACE keeps the existing signature, owner and execute ACL intact.
-- No job, cron, kick, queue, app flag or current credential is changed here.

create or replace function kc_private.invoke_edge_function(p_function text, p_body jsonb default '{}'::jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
  v_request_id bigint;
begin
  if p_function is null or p_function !~ '^[a-z][a-z0-9-]{1,62}$' then
    perform kc_private.ops_warn('edge_invocation_invalid_name', 'not an Edge Function name');
    return null;
  end if;
  if not kc_private.edge_invocation_ready() then
    perform kc_private.ops_warn('edge_invocation_unavailable',
      'pg_net or Vault is not installed; ' || p_function || ' was not invoked');
    return null;
  end if;

  execute 'select (select s.decrypted_secret from vault.decrypted_secrets s where s.name = $1),
                  (select s.decrypted_secret from vault.decrypted_secrets s where s.name = $2)'
     into v_url, v_key
    using 'kc_project_url', 'kc_verified_service_role_key';
  if coalesce(v_url, '') = '' or coalesce(v_key, '') = '' then
    perform kc_private.ops_warn('edge_invocation_unconfigured',
      'Vault secret kc_project_url or kc_verified_service_role_key is missing; ' || p_function || ' was not invoked');
    return null;
  end if;

  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := $4)'
     into v_request_id
    using rtrim(v_url, '/') || '/functions/v1/' || p_function,
          coalesce(p_body, '{}'::jsonb),
          jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
          30000;
  return v_request_id;
exception when others then
  -- The SQLSTATE only: an error text could quote the request.
  perform kc_private.ops_warn('edge_invocation_failed:' || coalesce(p_function, ''), 'sqlstate ' || sqlstate);
  return null;
end;
$$;
comment on function kc_private.invoke_edge_function(text, jsonb) is
  'Queues an HTTP call to an Edge Function with the Vault service key; a recorded no-op when unavailable. Never raises.';
