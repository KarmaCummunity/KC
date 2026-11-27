-- Employment job offer: detail_schema declares requirements and estimated salary (#2537).
-- Catalog rows are seed-only (D-228) and seeds load after these tests, so this file
-- inserts the employment kinds and re-applies the migration-owned schema patch.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(4);

insert into public.worlds (slug, label_he, label_en)
values ('employment', 'employment', 'Employment');
insert into public.post_kinds (world_slug, slug, label_he, label_en, direction) values
  ('employment', 'job_offer', 'jo', 'Job offer', 'offer'),
  ('employment', 'job_request', 'jr', 'Job request', 'request');

select kc_private.apply_employment_job_offer_detail_schema();

select ok(
  exists (
    select 1 from public.post_kinds
    where world_slug = 'employment' and slug = 'job_offer'
      and detail_schema -> 'properties' ? 'job_requirements'
      and detail_schema -> 'properties' ? 'estimated_salary_min'
      and detail_schema -> 'properties' ? 'estimated_salary_max'
      and detail_schema -> 'properties' ? 'salary_pay_period'
  ),
  'job_offer detail_schema lists requirements and estimated salary keys'
);

select is(
  (select detail_schema -> 'properties' -> 'salary_pay_period' -> 'enum'
     from public.post_kinds
    where world_slug = 'employment' and slug = 'job_offer'),
  '["pay_hourly", "pay_monthly"]'::jsonb,
  'salary_pay_period accepts hourly and monthly'
);

select ok(
  (select detail_schema -> 'required' ? 'role'
     and detail_schema -> 'required' ? 'job_scope'
     from public.post_kinds
    where world_slug = 'employment' and slug = 'job_offer'),
  'role and job_scope stay required on a job offer'
);

select ok(
  not exists (
    select 1 from public.post_kinds
    where world_slug = 'employment' and slug = 'job_request'
      and detail_schema -> 'properties' ? 'job_requirements'
  ),
  'looking for work does not gain the job-offer salary fields'
);

select * from finish();
rollback;
