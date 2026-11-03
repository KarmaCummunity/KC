-- 0540_listing_details_schema_enforced | The server checks a native listing's details
-- against its kind's `listing_kinds.detail_schema`, as the app already does
-- (`@kc/domain` validateListingDetails). Closes TD-261.
--
-- `listings_validate_details_schema` (0242) called `json_matches_schema(json, jsonb)`, a
-- signature pg_jsonschema does not have; its `undefined_function` handler swallowed the
-- error, so no schema was ever enforced. Now:
--   * it calls `jsonb_matches_schema(json, jsonb)` and raises `listing_details_schema_mismatch`
--     (23514; the app already translates it) with the validator's messages as DETAIL;
--   * only `origin = 'native'` rows are checked — the create form's listings. Rows the post
--     engine (`post`) and the ingestion pipeline write carry keys of their own (the post
--     engine's address fields) that the kind schemas do not describe;
--   * a JSON null counts as an absent key, the app validator's rule, so a cleared optional
--     field never fails;
--   * a missing extension fails loudly instead of skipping the check.
-- The trigger still fires on insert and on a change of `details` / `kind_id`, so existing
-- rows are checked the next time those change. Idempotent.

begin;

create extension if not exists pg_jsonschema with schema extensions;

create or replace function public.listings_validate_details_schema()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  v_schema jsonb;
  v_details jsonb;
begin
  if new.origin <> 'native' then
    return new;
  end if;

  select lk.detail_schema into v_schema
    from public.listing_kinds lk
   where lk.kind_id = new.kind_id;
  if v_schema is null then
    return new;
  end if;

  v_details := jsonb_strip_nulls(coalesce(new.details, '{}'::jsonb));
  if not extensions.jsonb_matches_schema(v_schema::json, v_details) then
    raise exception 'listing_details_schema_mismatch'
      using errcode = '23514',
            detail = array_to_string(
              extensions.jsonschema_validation_errors(v_schema::json, v_details::json), '; ');
  end if;

  return new;
end;
$$;

comment on function public.listings_validate_details_schema() is
  'Trigger: a native listing''s details (nulls as absent) must match its kind''s detail_schema; raises listing_details_schema_mismatch (23514). 0540.';

commit;
