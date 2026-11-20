-- Production copy (FR-ADMIN-037) · the one entry point the weekly job calls on kc-dev.
--
-- The job (.github/workflows/prod-copy-to-dev.yml) reads kc-prod, anonymizes the rows in that
-- same step and hands kc-dev one JSON document:
--   { "format": 1, "members": [...], "organizations": [...], "posts": [...],
--     "follows": [...], "saved_posts": [...] }
-- Each array is described in the file of the phase that reads it.

-- Version of the document this file understands. A job built for another version is refused
-- before anything is written, so a half-understood copy never lands.
create or replace function kc_private.prod_copy_format()
returns integer
language sql
immutable
set search_path = ''
as $$ select 1; $$;

-- Applies one copy. The caller runs it in a single transaction (AC11: a failure leaves kc-dev
-- as it was). Writes run as the system, with no caller identity: a copied post may return to
-- open past the per-member quota, and no member rate limit applies (production already held
-- them to both). Returns the counts the job logs (AC10: counts only).
create or replace function kc_private.prod_copy_apply(p_copy jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_claims constant text := current_setting('request.jwt.claims', true);
  v_sub constant text := current_setting('request.jwt.claim.sub', true);
  v_result jsonb;
begin
  if not coalesce((select s.is_dev_environment from kc_private.prod_copy_state s where s.singleton), false) then
    raise exception 'not_dev_environment' using errcode = '42501';
  end if;
  if jsonb_typeof(p_copy) is distinct from 'object'
     or (p_copy ->> 'format')::integer is distinct from kc_private.prod_copy_format() then
    raise exception 'prod_copy_bad_format' using errcode = 'P0001';
  end if;

  -- One copy at a time, and never while "Delete copied data" runs (prod_copy_delete_all).
  perform pg_advisory_xact_lock(hashtext('kc.prod_copy'));
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('kc.fsm_role', 'system', true);
  perform set_config('kc.rate_limit_exempt', 'on', true);

  -- Members first (posts hang on them), then organizations, posts, and the pairs between them.
  v_result := kc_private.prod_copy_sync_members(coalesce(p_copy -> 'members', '[]'))
           || kc_private.prod_copy_sync_organizations(coalesce(p_copy -> 'organizations', '[]'))
           || kc_private.prod_copy_sync_posts(coalesce(p_copy -> 'posts', '[]'))
           || kc_private.prod_copy_sync_social(coalesce(p_copy -> 'follows', '[]'),
                                               coalesce(p_copy -> 'saved_posts', '[]'));

  update kc_private.prod_copy_state
     set last_copied_at = now(), last_result = v_result, updated_at = now()
   where singleton;

  perform set_config('kc.rate_limit_exempt', '', true);
  perform set_config('kc.fsm_role', '', true);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  return v_result;
end;
$$;
comment on function kc_private.prod_copy_apply(jsonb) is
  'FR-ADMIN-037: applies one anonymized production copy to kc-dev (dev marker required).';

revoke all on function kc_private.prod_copy_apply(jsonb) from public, anon, authenticated;
revoke all on function kc_private.prod_copy_delete_all() from public, anon, authenticated;
