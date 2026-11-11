-- Content seed: the curated rows a new environment ships with (see README.md).
--
-- Real product content, not demo data and not member-generated: the lists of organization
-- links, the legal texts, the in-app surveys and the platform organization with its
-- finance accounts. Loaded into kc-prod, kc-dev and local stacks alike, after the baseline
-- and the reference data (supabase/seed/reference), and before any member signs up.
--
-- Idempotent: a row is inserted, or updated only when it differs from the file; a second
-- run reports zero changes. Nothing is ever deleted (a retired link is hidden through the
-- review queue, not removed here). Legal text is append-only: a version already published
-- is never rewritten, and a new version is published through the admin RPC, not here.
-- Run through load.sh, which starts psql in this directory (the \copy paths are relative)
-- and wraps the file in one transaction.

create temporary table seed_link_categories (slug text, icon_name text, sort_order integer, is_active boolean) on commit drop;
create temporary table seed_links (category_slug text, url text, display_name text, description text, validated_at timestamptz) on commit drop;
create temporary table seed_legal_versions (
  doc_type text, version integer, language text, effective_date timestamptz, severity text,
  change_summary text, body_md text) on commit drop;
create temporary table seed_surveys (
  slug text, title_he text, description_he text, is_active boolean, current_version integer, prompt_rules jsonb) on commit drop;
create temporary table seed_survey_versions (survey_slug text, version integer) on commit drop;
create temporary table seed_survey_questions (
  survey_slug text, version integer, sort_order integer, question_type text, short_label_he text,
  prompt_he text, context_he text, text_placeholder_he text, rating_anchor_low_he text,
  rating_anchor_high_he text, choice_options jsonb) on commit drop;

\copy seed_link_categories from 'data/donation_link_categories.csv' with (format csv, header true)
\copy seed_links from 'data/donation_links.csv' with (format csv, header true)
\copy seed_legal_versions from 'data/legal_document_versions.csv' with (format csv, header true)
\copy seed_surveys from 'data/surveys.csv' with (format csv, header true)
\copy seed_survey_versions from 'data/survey_versions.csv' with (format csv, header true)
\copy seed_survey_questions from 'data/survey_questions.csv' with (format csv, header true)

-- 1. Lists of organization links, then the links themselves. A curated link has no
--    submitter and is already approved; it is matched by its list and address.
with changed as (
  insert into public.donation_link_categories as c (slug, icon_name, sort_order, is_active)
  select s.slug, s.icon_name, s.sort_order, s.is_active from seed_link_categories s
  on conflict (slug) do update
     set icon_name = excluded.icon_name, sort_order = excluded.sort_order, is_active = excluded.is_active
   where (c.icon_name, c.sort_order, c.is_active) is distinct from (excluded.icon_name, excluded.sort_order, excluded.is_active)
  returning 1
)
select 'donation_link_categories' as seed_table, (select count(*) from seed_link_categories) as rows_in_file,
       (select count(*) from changed) as rows_changed;

-- A new or edited link goes back to the review queue by trigger; the loader then approves
-- the curated ones in the machine role `reviewer`. Only a pending curated link is approved:
-- one a moderator rejected stays rejected.
select set_config('kc.fsm_role', 'reviewer', true);
create temporary table seed_link_changes (n integer) on commit drop;
with updated as (
  update public.donation_links l
     set display_name = s.display_name, description = nullif(s.description, '')
    from seed_links s
   where l.category_slug = s.category_slug and l.url = s.url and l.submitted_by is null
     and (l.display_name, l.description) is distinct from (s.display_name, nullif(s.description, ''))
  returning 1
)
insert into seed_link_changes select count(*) from updated;
with inserted as (
  insert into public.donation_links (category_slug, url, display_name, description, submitted_by, validated_at)
  select s.category_slug, s.url, s.display_name, nullif(s.description, ''), null, s.validated_at
    from seed_links s
   where not exists (select 1 from public.donation_links l
                      where l.category_slug = s.category_slug and l.url = s.url)
  returning 1
)
insert into seed_link_changes select count(*) from inserted;
update public.donation_links l
   set review_status = 'approved', reviewed_at = s.validated_at
  from seed_links s
 where l.category_slug = s.category_slug and l.url = s.url and l.submitted_by is null
   and l.review_status = 'pending';
select 'donation_links' as seed_table, (select count(*) from seed_links) as rows_in_file,
       (select sum(n) from seed_link_changes) as rows_changed;
select set_config('kc.fsm_role', '', true);

-- 2. Legal documents: the pointer row first, then each version once.
with pointer as (
  insert into public.legal_documents as d (doc_type, current_version, current_effective_date)
  select s.doc_type, max(s.version), (array_agg(s.effective_date order by s.version desc))[1]
    from seed_legal_versions s group by s.doc_type
  on conflict (doc_type) do nothing
  returning 1
), versions as (
  insert into public.legal_document_versions (doc_type, version, language, effective_date, severity, change_summary, body_md)
  select s.doc_type, s.version, s.language, s.effective_date, s.severity, nullif(s.change_summary, ''), s.body_md
    from seed_legal_versions s
  on conflict (doc_type, version) do nothing
  returning 1
)
select 'legal_documents' as seed_table, (select count(*) from seed_legal_versions) as rows_in_file,
       (select count(*) from pointer) + (select count(*) from versions) as rows_changed;

-- 3. Surveys: catalog, then each published version with its questions. A published version
--    is immutable, so an existing version keeps its questions as they are.
with changed as (
  insert into public.surveys as v (slug, title_he, description_he, is_active, current_version, prompt_rules)
  select s.slug, s.title_he, nullif(s.description_he, ''), s.is_active, s.current_version, s.prompt_rules from seed_surveys s
  on conflict (slug) do update
     set title_he = excluded.title_he, description_he = excluded.description_he,
         is_active = excluded.is_active, prompt_rules = excluded.prompt_rules
   where (v.title_he, v.description_he, v.is_active, v.prompt_rules)
         is distinct from (excluded.title_he, excluded.description_he, excluded.is_active, excluded.prompt_rules)
  returning 1
)
select 'surveys' as seed_table, (select count(*) from seed_surveys) as rows_in_file,
       (select count(*) from changed) as rows_changed;

with new_versions as (
  insert into public.survey_versions (survey_id, version)
  select sv.id, s.version
    from seed_survey_versions s join public.surveys sv on sv.slug = s.survey_slug
  on conflict (survey_id, version) do nothing
  returning id, survey_id, version
), questions as (
  insert into public.survey_questions (survey_version_id, sort_order, question_type, short_label_he, prompt_he,
                                       context_he, text_placeholder_he, rating_anchor_low_he,
                                       rating_anchor_high_he, choice_options)
  select nv.id, q.sort_order, q.question_type, q.short_label_he, q.prompt_he, coalesce(q.context_he, ''),
         coalesce(q.text_placeholder_he, ''), coalesce(q.rating_anchor_low_he, ''),
         coalesce(q.rating_anchor_high_he, ''), q.choice_options
    from seed_survey_questions q
    join public.surveys sv on sv.slug = q.survey_slug
    join new_versions nv on nv.survey_id = sv.id and nv.version = q.version
  returning 1
)
select 'survey_versions' as seed_table, (select count(*) from seed_survey_versions) as rows_in_file,
       (select count(*) from new_versions) + (select count(*) from questions) as rows_changed;

-- 4. The platform organization (exactly one) and its finance accounts, empty balances.
--    Two statements: the accounts read the organization the first one wrote.
create temporary table seed_platform_changes (n integer) on commit drop;
with org as (
  insert into public.organizations (slug, name, is_platform)
  select 'karma-community', 'Karma Community', true
   where not exists (select 1 from public.organizations where is_platform)
  returning 1
)
insert into seed_platform_changes select count(*) from org;
with accounts as (
  insert into billing.org_finance_accounts (org_id, name, kind, sort_order)
  select o.id, a.name, a.kind, a.sort_order
    from public.organizations o,
         (values ('מזומן', 'cash', 0), ('Bit', 'bit', 1), ('Paybox', 'paybox', 2)) as a (name, kind, sort_order)
   where o.is_platform
  on conflict (org_id, name) do nothing
  returning 1
)
insert into seed_platform_changes select count(*) from accounts;
select 'platform_organization' as seed_table, 1 as rows_in_file, coalesce(sum(n), 0) as rows_changed
  from seed_platform_changes;
