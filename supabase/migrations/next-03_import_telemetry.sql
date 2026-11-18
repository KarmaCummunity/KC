-- External post import · telemetry (FR-IMPORT-010 AC4, FR-IMPORT-008 AC3, KC#2350).
--
-- The production signal of extraction quality: per draft field, the share of published imports
-- whose member changed that field before publishing (`import_field_edit_rate`), and the import
-- funnel (attempts, drafts, published, discarded) for the team. The daily provider budget joins
-- the health registry (D68), so the PM hears about it before imports fall back to manual.
--
-- Nothing identifies a member: the admin functions return counts only, for moderators and above.

-- ── What the member changed ──────────────────────────────────────────────────────────────────
-- The draft fields the member changed before publishing; null until the app reports them (or
-- when an older app published the post). Field names are the domain's IMPORT_EDITABLE_FIELDS.
alter table public.external_post_imports add column edited_fields text[]
  check (edited_fields <@ array['world', 'direction', 'kind', 'subcategory', 'title', 'description', 'city']::text[]);
comment on column public.external_post_imports.edited_fields is
  'Draft fields the member changed before publishing (FR-IMPORT-010 AC4); null when not reported.';

-- Records the edits of the caller's published import. Only a published import (its post exists);
-- reporting again replaces the earlier report.
create function public.api_import_record_edits(p_import_id uuid, p_edited_fields text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid constant uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  update public.external_post_imports i
     set edited_fields = (select coalesce(array_agg(distinct f order by f), '{}') from unnest(p_edited_fields) f)
   where i.id = p_import_id and i.user_id = v_uid and i.status = 'published';
  if not found then
    raise exception 'import_not_published' using errcode = 'P0002';
  end if;
end;
$$;
comment on function public.api_import_record_edits(uuid, text[]) is
  'Records which draft fields the member changed before publishing their import (FR-IMPORT-010 AC4).';
revoke all on function public.api_import_record_edits(uuid, text[]) from public;
grant execute on function public.api_import_record_edits(uuid, text[]) to authenticated;

-- ── The funnel, for the team ─────────────────────────────────────────────────────────────────
-- Attempts in the last p_days (1..365), by outcome:
--   attempts   every extraction attempt (cache hits and refusals included)
--   manual     attempts that ended on the manual route (a refusal, nothing to extract, a failure)
--   drafted    attempts that produced a draft (ready or confirm)
--   published  drafts the member published
--   discarded  drafts never published within a day (or marked discarded)
--   provider_calls  attempts that called the model (the cost)
-- Moderators and above. Errors: unauthenticated / forbidden (42501).
create function public.admin_import_funnel(p_days integer default 30)
returns table (attempts integer, manual integer, drafted integer, published integer, discarded integer, provider_calls integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days constant integer := least(greatest(coalesce(p_days, 30), 1), 365);
begin
  perform kc_private.require_admin_role('moderator');
  return query
  select count(*)::integer,
         (count(*) filter (where i.routing = 'manual'))::integer,
         (count(*) filter (where i.routing <> 'manual'))::integer,
         (count(*) filter (where i.status = 'published'))::integer,
         (count(*) filter (where i.routing <> 'manual'
                             and (i.status = 'discarded'
                                  or (i.status = 'drafted' and i.created_at < now() - interval '1 day'))))::integer,
         (count(*) filter (where i.provider_called))::integer
    from public.external_post_imports i
   where i.created_at > now() - make_interval(days => v_days);
end;
$$;
comment on function public.admin_import_funnel(integer) is
  'Import funnel of the last p_days: attempts, manual, drafted, published, discarded, model calls (FR-IMPORT-010 AC4).';
revoke all on function public.admin_import_funnel(integer) from public;
grant execute on function public.admin_import_funnel(integer) to authenticated;

-- import_field_edit_rate: per field, among the published imports of the last p_days that reported
-- their edits, how many changed the field, and the rate (0..1, two decimals; null when none reported).
-- Moderators and above.
create function public.admin_import_field_edit_rates(p_days integer default 30)
returns table (field text, reported integer, edited integer, edit_rate numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days constant integer := least(greatest(coalesce(p_days, 30), 1), 365);
begin
  perform kc_private.require_admin_role('moderator');
  return query
  with reported as (
    select i.edited_fields
      from public.external_post_imports i
     where i.status = 'published' and i.edited_fields is not null
       and i.created_at > now() - make_interval(days => v_days)
  )
  select f.name,
         (select count(*) from reported)::integer,
         (select count(*) from reported r where f.name = any (r.edited_fields))::integer,
         round((select count(*) from reported r where f.name = any (r.edited_fields))::numeric
               / nullif((select count(*) from reported), 0), 2)
    from unnest(array['world', 'direction', 'kind', 'subcategory', 'title', 'description', 'city']) with ordinality as f(name, ord)
   order by f.ord;
end;
$$;
comment on function public.admin_import_field_edit_rates(integer) is
  'import_field_edit_rate per draft field over the last p_days (FR-IMPORT-010 AC4).';
revoke all on function public.admin_import_field_edit_rates(integer) from public;
grant execute on function public.admin_import_field_edit_rates(integer) to authenticated;

-- ── The budget in the health registry (FR-IMPORT-008 AC3, D68) ────────────────────────────────
-- The cap itself is DEFAULT_LIMITS.dailyBudget (2000) in the extraction function; the check fails
-- at 90 % of it, so the alert comes while imports still work.
insert into ops.health_checks (name, description, max_allowed, period, failure_means) values
  ('import_provider_budget', 'Model calls of the post import since the start of the UTC day.', 1800, interval '1 day',
   'Imports are close to the daily model budget: after it, every import falls back to the manual form. Check for abuse in external_post_imports, or raise the budget.');

create function ops.import_health_measurements()
returns table (check_name text, measured bigint, detail text)
language sql
stable
security definer
set search_path = ''
as $$
  select 'import_provider_budget', count(*), 'since ' || date_trunc('day', now() at time zone 'utc')::text || ' UTC'
    from public.external_post_imports i
   where i.provider_called
     and i.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
$$;
comment on function ops.import_health_measurements() is 'Measures the import health checks; internal to ops.run_health_checks().';

-- run_health_checks also reads the import measurements (as 0057 added the WhatsApp ones).
create or replace function ops.run_health_checks()
returns table (check_name text, status text, measured bigint, max_allowed bigint, detail text, failure_means text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.name,
         case when m.check_name is null then 'skipped'
              when m.measured > c.max_allowed then 'failing'
              else 'ok' end,
         m.measured, c.max_allowed, m.detail, c.failure_means
    from ops.health_checks c
    left join (select * from ops.health_measurements()
               union all select * from ops.whatsapp_health_measurements()
               union all select * from ops.import_health_measurements()) m on m.check_name = c.name
   order by c.name;
$$;
