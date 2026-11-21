-- Employment · job offer fields: requirements and estimated salary (#2537).
-- Declares the keys on `post_kinds.detail_schema` for `employment/job_offer`. Details stay in
-- `posts.details` (no dedicated detail table). Looking for work is unchanged.
--
-- Catalog rows come from the reference seed (D-228), so a fresh baseline has no job_offer
-- row when numbered migrations are applied. This function is the SSOT for the patch: the
-- migration applies it on already-seeded databases; pgTAP and the reference loader re-apply
-- it once the catalog row exists.

create or replace function kc_private.apply_employment_job_offer_detail_schema()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.post_kinds
  set detail_schema = jsonb_build_object(
    'type', 'object',
    'properties', jsonb_build_object(
      'role', jsonb_build_object('type', 'string', 'maxLength', 80),
      'job_scope', jsonb_build_object(
        'type', 'string',
        'enum', jsonb_build_array('job_full_time', 'job_part_time', 'job_hourly', 'job_freelance')
      ),
      'work_mode', jsonb_build_object(
        'type', 'string',
        'enum', jsonb_build_array('on_site', 'remote', 'hybrid')
      ),
      'job_requirements', jsonb_build_object('type', 'string', 'maxLength', 2000),
      'estimated_salary_min', jsonb_build_object('type', 'number', 'minimum', 0, 'maximum', 500000),
      'estimated_salary_max', jsonb_build_object('type', 'number', 'minimum', 0, 'maximum', 500000),
      'salary_pay_period', jsonb_build_object(
        'type', 'string',
        'enum', jsonb_build_array('pay_hourly', 'pay_monthly')
      ),
      -- Injected by the create form when the offer names its organization (§5.11).
      'org_id', jsonb_build_object('type', 'string', 'format', 'uuid')
    ),
    'required', jsonb_build_array('role', 'job_scope')
  )
  where world_slug = 'employment' and slug = 'job_offer';
$$;

comment on function kc_private.apply_employment_job_offer_detail_schema() is
  'Sets employment/job_offer detail_schema for requirements and estimated salary (#2537). Safe to call when the catalog row is missing.';

select kc_private.apply_employment_job_offer_detail_schema();

comment on column public.post_kinds.detail_schema is
  'JSON Schema for posts.details of this kind. Employment job offers declare role, scope, where, requirements and estimated salary (#2537).';
